// Build pipeline (Technical Design §6): validate → normalise → cache → guard → preprocess → compile (sandbox) → link
// against prebuilt core/library archives → HEX + size report. Deterministic: same request + toolchain ⇒ same HEX.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILD_LIMITS, type BuildDiagnostic, type BuildLibrary, type BuildRequest } from '@robosim/shared';
import { parseDiagnostics, type PathMap } from './diagnostics.js';
import { includedNames, scanSources } from './includes.js';
import { compileArgs, ensurePrebuilt, includeFlags, archiveName } from './prebuilt.js';
import { preprocessSketch, type SourceFile } from './preprocess.js';
import { directRunner, sandboxAvailable, sandboxRunner, type Runner } from './runner.js';
import {
  BOARDS,
  FLAGS,
  headerIndex,
  loadToolchain,
  ToolchainError,
  type Library,
  type Toolchain,
} from './toolchain.js';

export interface CompilerOptions {
  readonly toolchainDir?: string;
  /** Content-addressed results, artifacts and prebuilt archives. */
  readonly cacheDir: string;
  /** Run user builds in the namespace sandbox (required for untrusted input). */
  readonly sandbox: boolean;
  readonly maxConcurrency?: number;
  readonly timeoutMs?: number;
}

export interface SizeReport {
  readonly flashBytes: number;
  readonly ramBytes: number;
  readonly flashPct: number;
  readonly ramPct: number;
}

export interface CompileOutput {
  readonly status: 'succeeded' | 'failed';
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly artifact?: { readonly sha256: string; readonly sizeBytes: number; readonly size: SizeReport };
  /** Libraries linked into the build (resolved from includes + declared). */
  readonly libraries: readonly BuildLibrary[];
  readonly durationMs: number;
}

type Stored = Omit<CompileOutput, 'cacheHit' | 'durationMs'>;

const LOW_MEMORY_PCT = 75;
const SKETCH_DIR = 'sketch';
const BUILD_DIR = 'build';

/** LF line endings, no trailing whitespace, sorted by name (cache-key normalisation, §6). */
export function normalizeFiles(files: readonly SourceFile[]): SourceFile[] {
  return files
    .map((f) => ({
      name: f.name,
      content: f.content
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n'),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export class Compiler {
  private readonly headers: Map<string, Library>;
  private readonly slots: Semaphore;
  private readonly timeoutMs: number;
  readonly toolchain: Toolchain;
  private readonly options: CompilerOptions;

  private constructor(toolchain: Toolchain, options: CompilerOptions) {
    this.toolchain = toolchain;
    this.options = options;
    this.headers = headerIndex(toolchain);
    this.slots = new Semaphore(options.maxConcurrency ?? 2);
    this.timeoutMs = options.timeoutMs ?? BUILD_LIMITS.timeoutMs;
  }

  /** Loads the toolchain and checks the sandbox; throws `ToolchainError` with a fix-it message. */
  static async create(options: CompilerOptions): Promise<Compiler> {
    const toolchain = loadToolchain(options.toolchainDir);
    if (options.sandbox && !(await sandboxAvailable()))
      throw new ToolchainError(
        'unprivileged user namespaces are unavailable; the build sandbox cannot start',
      );
    await mkdir(options.cacheDir, { recursive: true });
    return new Compiler(toolchain, options);
  }

  /** sha256(normalised sources ‖ main file ‖ fqbn ‖ sorted declared libraries ‖ toolchain id), §6. */
  cacheKey(request: BuildRequest): string {
    const files = normalizeFiles(request.files);
    const libs = [...request.libraries].map((l) => `${l.name}@${l.version}`).sort();
    return sha256(
      JSON.stringify({
        files: files.map((f) => [f.name, f.content]),
        main: mainSketch(request.files),
        fqbn: BOARDS[request.board].fqbn,
        libs,
        toolchain: this.toolchain.id,
      }),
    );
  }

  /** The stored result for these sources, without compiling; lets a gateway answer cache hits before queueing. */
  async cached(request: BuildRequest): Promise<CompileOutput | undefined> {
    const started = performance.now();
    const cached = await this.readResult(this.cacheKey(request));
    return cached && { ...cached, cacheHit: true, durationMs: performance.now() - started };
  }

  async build(request: BuildRequest): Promise<CompileOutput> {
    const started = performance.now();
    const key = this.cacheKey(request);
    const cached = await this.readResult(key);
    if (cached) return { ...cached, cacheHit: true, durationMs: performance.now() - started };
    const result = await this.slots.run(() => this.compile(request, key));
    // Timeouts depend on machine load, not on the request: never cache them.
    if (!result.diagnostics.some((d) => d === TIMED_OUT.get(d.message))) await this.writeResult(key, result);
    return { ...result, cacheHit: false, durationMs: performance.now() - started };
  }

  /** HEX text of a stored artifact, or undefined. */
  async readArtifact(sha: string): Promise<string | undefined> {
    if (!/^[0-9a-f]{64}$/.test(sha)) return undefined;
    const path = join(this.options.cacheDir, 'artifacts', `${sha}.hex`);
    return existsSync(path) ? readFile(path, 'utf8') : undefined;
  }

  /** Libraries a library's own sources include (one level; the index resolves the rest). */
  private libDeps = (lib: Library, seen = new Set<string>([lib.name])): Library[] => {
    const deps: Library[] = [];
    for (const dep of this.libraryIncludes(lib)) {
      if (seen.has(dep.name)) continue;
      seen.add(dep.name);
      deps.push(dep, ...this.libDeps(dep, seen));
    }
    return deps;
  };

  private readonly libIncludeCache = new Map<string, Library[]>();
  private libraryIncludes(lib: Library): Library[] {
    let deps = this.libIncludeCache.get(lib.name);
    if (!deps) {
      deps = [];
      const own = new Set(lib.headers);
      for (const name of scanTree(lib.sources, lib.recursive)) {
        const dep = this.headers.get(name);
        if (dep && dep !== lib && !own.has(name) && !deps.includes(dep)) deps.push(dep);
      }
      this.libIncludeCache.set(lib.name, deps);
    }
    return deps;
  }

  private async compile(request: BuildRequest, key: string): Promise<Stored> {
    const deadline = Date.now() + this.timeoutMs;
    const board = BOARDS[request.board];
    const files = normalizeFiles(request.files);
    const failed = (diagnostics: BuildDiagnostic[], libraries: BuildLibrary[] = []): Stored => ({
      status: 'failed',
      cacheKey: key,
      diagnostics,
      libraries,
    });

    const scan = scanSources(files);
    if (scan.errors.length > 0) return failed(scan.errors);

    // Libraries: declared ones must be on the allow-list; included headers pull in their library (+ its deps).
    const libs = new Map<string, Library>();
    const libErrors: BuildDiagnostic[] = [];
    for (const d of request.libraries) {
      const lib = this.toolchain.libraries.get(d.name);
      if (!lib)
        libErrors.push(
          libraryError(
            `library '${d.name}' is not available (allowed: ${[...this.toolchain.libraries.keys()].join(', ')})`,
          ),
        );
      else if (lib.version !== d.version)
        libErrors.push(
          libraryError(`library '${d.name}' version ${d.version} is not available (have ${lib.version})`),
        );
      else libs.set(lib.name, lib);
    }
    if (libErrors.length > 0) return failed(libErrors);
    const userFiles = new Set(files.map((f) => f.name));
    for (const inc of scan.includes) {
      if (inc.quoted && userFiles.has(inc.name)) continue;
      const lib = this.headers.get(inc.name);
      if (lib) libs.set(lib.name, lib);
    }
    for (const lib of [...libs.values()]) for (const dep of this.libDeps(lib)) libs.set(dep.name, dep);
    const linked = [...libs.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
    const libraries = linked.map((l) => ({ name: l.name, version: l.version }));

    const prebuilt = await ensurePrebuilt(this.toolchain, request.board, this.options.cacheDir, (l) =>
      this.libDeps(l),
    );
    const work = await mkdtemp(join(tmpdir(), 'robosim-build-'));
    try {
      const mounts = { work, toolchain: this.toolchain.dir, prebuilt: prebuilt.dir };
      const runner: Runner = this.options.sandbox ? sandboxRunner(mounts) : directRunner(mounts);
      const p = runner.paths;
      const tc = (path: string): string => path.replace(this.toolchain.dir, p.toolchain);
      const sketchDir = join(work, SKETCH_DIR);
      await mkdir(sketchDir);
      await mkdir(join(work, BUILD_DIR));

      // Translation units: the merged .ino files + the user's .c/.cpp files; headers are only included.
      const main = mainSketch(request.files);
      const ino = files.filter((f) => f.name.endsWith('.ino'));
      const tuName = `${main}.cpp`;
      for (const f of files) await writeFile(join(sketchDir, f.name), f.content);
      await writeFile(join(sketchDir, tuName), preprocessSketch(ino, main).code);
      const units = [tuName, ...files.filter((f) => /\.(c|cpp)$/.test(f.name)).map((f) => f.name)];

      const includes = includeFlags(this.toolchain, board, linked).map((flag) => tc(flag));
      const map: PathMap = {
        prefixes: [
          [`${p.work}/${SKETCH_DIR}/${tuName}`, main],
          [`${p.work}/${SKETCH_DIR}/`, ''],
          [`${p.toolchain}/core/`, 'arduino:avr/'],
          [`${p.toolchain}/libraries/`, ''],
          ['/usr/lib/avr/include/', 'avr-libc/'],
          ['/usr/lib/gcc/avr/', 'avr-gcc/'],
        ],
      };
      const diagnostics: BuildDiagnostic[] = [];
      const objects: string[] = [];
      let compileFailed = false;
      for (const [k, unit] of units.entries()) {
        const obj = `../${BUILD_DIR}/${k}.o`;
        const r = await runner.run([...compileArgs(unit, board, includes, ['-Wall']), '-o', obj], {
          cwd: sketchDir,
          deadline,
        });
        if (r.timedOut) return failed([timeoutError(this.timeoutMs)], libraries);
        diagnostics.push(
          ...parseDiagnostics(r.output, map).map((d) => (d.file === tuName ? { ...d, file: main } : d)),
        );
        if (r.code !== 0) compileFailed = true;
        objects.push(obj);
      }
      if (compileFailed) return failed(ensureError(diagnostics, 'compilation failed'), libraries);

      const elf = `../${BUILD_DIR}/firmware.elf`;
      const archives = linked.map((l) => `${p.prebuilt}/${archiveName(l)}`);
      const link = await runner.run(
        [
          'avr-gcc',
          ...FLAGS.link,
          ...FLAGS.diagnostics,
          '-w',
          `-mmcu=${board.mcu}`,
          '-o',
          elf,
          ...objects,
          // One group: libraries depend on each other (Adafruit_MPU6050 → Adafruit_BusIO) in any order.
          '-Wl,--start-group',
          ...archives,
          `${p.prebuilt}/core.a`,
          '-lm',
          '-Wl,--end-group',
        ],
        { cwd: sketchDir, deadline },
      );
      if (link.timedOut) return failed([timeoutError(this.timeoutMs)], libraries);
      diagnostics.push(...parseDiagnostics(link.output, map));
      if (link.code !== 0) return failed(ensureError(diagnostics, 'linking failed'), libraries);

      const hexPath = `../${BUILD_DIR}/firmware.hex`;
      const objcopy = await runner.run(['avr-objcopy', '-O', 'ihex', '-R', '.eeprom', elf, hexPath], {
        cwd: sketchDir,
        deadline,
      });
      const sizes = await runner.run(['avr-size', '-A', elf], { cwd: sketchDir, deadline });
      if (objcopy.code !== 0 || sizes.code !== 0)
        throw new Error(`objcopy/size failed: ${objcopy.output}${sizes.output}`);
      const size = sizeReport(sizes.output, board.maxFlashBytes, board.maxRamBytes);
      if (size.flashBytes > board.maxFlashBytes)
        return failed(
          [
            ...diagnostics,
            sizeError(`sketch too big: ${size.flashBytes} bytes of ${board.maxFlashBytes} bytes of flash`),
          ],
          libraries,
        );
      if (size.ramBytes > board.maxRamBytes)
        return failed(
          [
            ...diagnostics,
            sizeError(
              `global variables use ${size.ramBytes} bytes, region \`data' overflowed (max ${board.maxRamBytes})`,
            ),
          ],
          libraries,
        );
      if (size.ramPct >= LOW_MEMORY_PCT)
        diagnostics.push({
          file: '',
          line: 0,
          column: 0,
          severity: 'warning',
          message: `low memory available: global variables use ${size.ramPct}% of RAM; stability problems may occur`,
          explanationKey: 'low_memory',
        });

      // objcopy writes CRLF; artifacts are canonical LF so their hash is stable everywhere.
      const hex = (await readFile(join(sketchDir, hexPath), 'utf8')).replaceAll('\r\n', '\n');
      const sha = sha256(hex);
      await this.writeArtifact(sha, hex);
      return {
        status: 'succeeded',
        cacheKey: key,
        diagnostics,
        libraries,
        artifact: { sha256: sha, sizeBytes: Buffer.byteLength(hex), size },
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private async readResult(key: string): Promise<Stored | undefined> {
    const path = join(this.options.cacheDir, 'results', `${key}.json`);
    if (!existsSync(path)) return undefined;
    const stored = JSON.parse(await readFile(path, 'utf8')) as Stored;
    // A result whose artifact was evicted is a miss.
    if (
      stored.artifact &&
      !existsSync(join(this.options.cacheDir, 'artifacts', `${stored.artifact.sha256}.hex`))
    )
      return undefined;
    return stored;
  }

  private async writeResult(key: string, result: Stored): Promise<void> {
    const stored: Stored = {
      status: result.status,
      cacheKey: result.cacheKey,
      diagnostics: result.diagnostics,
      libraries: result.libraries,
      ...(result.artifact ? { artifact: result.artifact } : {}),
    };
    await atomicWrite(join(this.options.cacheDir, 'results', `${key}.json`), JSON.stringify(stored));
  }

  private async writeArtifact(sha: string, hex: string): Promise<void> {
    await atomicWrite(join(this.options.cacheDir, 'artifacts', `${sha}.hex`), hex);
  }
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const staged = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(staged, data);
  await rename(staged, path);
}

/** The main .ino: the first one in the request (the project's main file), as the Arduino IDE's folder-named one. */
export function mainSketch(files: readonly SourceFile[]): string {
  const main = files.find((f) => f.name.endsWith('.ino'));
  if (!main) throw new Error('a sketch needs at least one .ino file');
  return main.name;
}

function* scanTree(dirs: readonly string[], recursive: boolean): Generator<string> {
  // Synchronous scan of trusted library sources (small, cached per library).
  const walk = function* (dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive && e.name !== 'examples' && !e.name.startsWith('.')) yield* walk(path);
      } else if (/\.(c|cpp|h|hpp|S)$/.test(e.name)) yield* includedNames(readFileSync(path, 'utf8'));
    }
  };
  for (const d of dirs) yield* walk(d);
}

const libraryError = (message: string): BuildDiagnostic => ({
  file: '',
  line: 0,
  column: 0,
  severity: 'error',
  message,
  explanationKey: 'library_not_available',
});

const sizeError = (message: string): BuildDiagnostic => ({
  file: '',
  line: 0,
  column: 0,
  severity: 'error',
  message,
  explanationKey: message.startsWith('sketch too big') ? 'flash_overflow' : 'ram_overflow',
});

const TIMED_OUT = new Map<string, BuildDiagnostic>();
const timeoutError = (ms: number): BuildDiagnostic => {
  const message = `build exceeded the ${ms / 1000} s time limit`;
  let d = TIMED_OUT.get(message);
  if (!d) {
    d = { file: '', line: 0, column: 0, severity: 'error', message };
    TIMED_OUT.set(message, d);
  }
  return d;
};

/** A failed step always reports at least one error, even when gcc's output was not parseable. */
function ensureError(diagnostics: BuildDiagnostic[], message: string): BuildDiagnostic[] {
  return diagnostics.some((d) => d.severity === 'error')
    ? diagnostics
    : [...diagnostics, { file: '', line: 0, column: 0, severity: 'error', message }];
}

export function sizeReport(avrSizeA: string, maxFlash: number, maxRam: number): SizeReport {
  const section = (name: string): number =>
    Number(new RegExp(`^\\${name}\\s+(\\d+)`, 'm').exec(avrSizeA)?.[1] ?? 0);
  const flashBytes = section('.text') + section('.data');
  const ramBytes = section('.data') + section('.bss') + section('.noinit');
  const pct = (n: number, max: number): number => Math.round((n / max) * 1000) / 10;
  return { flashBytes, ramBytes, flashPct: pct(flashBytes, maxFlash), ramPct: pct(ramBytes, maxRam) };
}
