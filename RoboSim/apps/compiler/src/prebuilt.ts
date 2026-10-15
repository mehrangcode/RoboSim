// Pre-built core and library archives per toolchain id (Technical Design §6: a cold build compiles only the sketch).
// Built from trusted, pinned sources outside the sandbox; written atomically so concurrent processes can share them.
import { availableParallelism, tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BOARDS, FLAGS, type BoardSpec, type Library, type Toolchain } from './toolchain.js';
import { directRunner } from './runner.js';
import type { BuildBoard } from '@robosim/shared';

export interface Prebuilt {
  readonly dir: string;
  /** Archive file name for the core (`core.a`) or a library. */
  readonly archives: ReadonlyMap<string, string>;
}

export const archiveName = (lib: Library): string => `lib${lib.name.replace(/[^A-Za-z0-9_]/g, '_')}.a`;

const sourceExt = /\.(c|cpp|S)$/;

async function listSources(dir: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && recursive && !e.name.startsWith('.') && e.name !== 'examples')
      out.push(...(await listSources(p, true)));
    else if (e.isFile() && sourceExt.test(e.name)) out.push(p);
  }
  return out.sort();
}

export function includeFlags(toolchain: Toolchain, board: BoardSpec, libs: readonly Library[]): string[] {
  return [
    `-I${join(toolchain.coreDir, 'cores/arduino')}`,
    `-I${join(toolchain.coreDir, 'variants', board.variant)}`,
    ...libs.map((l) => `-I${l.includeDir}`),
  ];
}

export function compileArgs(
  file: string,
  board: BoardSpec,
  includes: readonly string[],
  warnings: readonly string[],
): string[] {
  const ext = /\.(\w+)$/.exec(file)?.[1];
  const [cmd, flags] =
    ext === 'cpp' ? ['avr-g++', FLAGS.cpp] : ext === 'S' ? ['avr-gcc', FLAGS.S] : ['avr-gcc', FLAGS.c];
  return [
    cmd,
    ...flags,
    ...warnings,
    ...FLAGS.diagnostics,
    `-mmcu=${board.mcu}`,
    ...board.defines.map((d) => `-D${d}`),
    ...includes,
    file,
  ];
}

async function pool<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(items.length, availableParallelism()) }, async () => {
    for (let item = items[next++]; item !== undefined; item = items[next++]) await fn(item);
  });
  await Promise.all(workers);
}

async function buildArchive(
  name: string,
  sources: readonly string[],
  includes: readonly string[],
  board: BoardSpec,
  dest: string,
): Promise<void> {
  // Objects go to the (fast, local) temp dir; the archive is copied next to `dest` and renamed atomically.
  const work = await mkdtemp(join(tmpdir(), 'robosim-prebuilt-'));
  const run = directRunner({ work, toolchain: '', prebuilt: '' });
  const deadline = Date.now() + 10 * 60_000;
  const objects: string[] = [];
  try {
    await pool(sources, async (src) => {
      const obj = join(work, `${objects.length}-${basename(src)}.o`);
      objects.push(obj);
      const r = await run.run([...compileArgs(src, board, includes, ['-w']), '-o', obj], {
        cwd: work,
        deadline,
      });
      if (r.code !== 0) throw new Error(`${name}: compiling ${src} failed:\n${r.output}`);
    });
    const archive = join(work, 'out.a');
    if (objects.length > 0) {
      const r = await run.run(['avr-gcc-ar', 'rcs', archive, ...objects.sort()], { cwd: work, deadline });
      if (r.code !== 0) throw new Error(`${name}: ar failed:\n${r.output}`);
    } else {
      const r = await run.run(['avr-gcc-ar', 'rcs', archive], { cwd: work, deadline });
      if (r.code !== 0) throw new Error(`${name}: ar failed:\n${r.output}`);
    }
    const staged = `${dest}.${process.pid}.tmp`;
    await copyFile(archive, staged);
    await rename(staged, dest);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const inflight = new Map<string, Promise<void>>();

/** Ensures `core.a` and one archive per library exist for this toolchain and board. */
export async function ensurePrebuilt(
  toolchain: Toolchain,
  boardId: BuildBoard,
  cacheDir: string,
  libDeps: (lib: Library) => readonly Library[],
): Promise<Prebuilt> {
  const board = BOARDS[boardId];
  const dir = join(cacheDir, 'prebuilt', `${toolchain.id}-${boardId}`);
  await mkdir(dir, { recursive: true });
  const archives = new Map<string, string>();
  const jobs: Array<{ key: string; file: string; build: () => Promise<void> }> = [];

  const coreSources = [
    ...(await listSources(join(toolchain.coreDir, 'cores/arduino'), false)),
    ...(await listSources(join(toolchain.coreDir, 'variants', board.variant), false)),
  ];
  jobs.push({
    key: 'core',
    file: 'core.a',
    build: () =>
      buildArchive('core', coreSources, includeFlags(toolchain, board, []), board, join(dir, 'core.a')),
  });
  for (const lib of toolchain.libraries.values()) {
    const file = archiveName(lib);
    jobs.push({
      key: lib.name,
      file,
      build: async () => {
        const sources = (await Promise.all(lib.sources.map((d) => listSources(d, lib.recursive)))).flat();
        await buildArchive(
          lib.name,
          sources,
          includeFlags(toolchain, board, [lib, ...libDeps(lib)]),
          board,
          join(dir, file),
        );
      },
    });
  }
  await Promise.all(
    jobs.map(async (j) => {
      archives.set(j.key, j.file);
      const path = join(dir, j.file);
      if (existsSync(path)) return;
      let p = inflight.get(path);
      if (!p) {
        p = j.build().finally(() => inflight.delete(path));
        inflight.set(path, p);
      }
      await p;
    }),
  );
  return { dir, archives };
}
