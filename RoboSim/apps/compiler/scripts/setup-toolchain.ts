#!/usr/bin/env node
// Fetches the pinned Arduino core and libraries (toolchain.lock.json) into .local/toolchain and checks avr-gcc.
// Idempotent: a source whose pin already matches is left alone. Exit 1 on any mismatch (fail fast).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface GitSource {
  readonly name: string;
  readonly version: string;
  readonly git: string;
  readonly commit: string;
}
interface TarballSource {
  readonly name: string;
  readonly version: string;
  readonly tarball: string;
  readonly sha256: string;
}
type Source = GitSource | TarballSource;

const appDir = fileURLToPath(new URL('..', import.meta.url));
const lockPath = join(appDir, 'toolchain.lock.json');
const toolchainDir = process.env.COMPILER_TOOLCHAIN_DIR ?? join(appDir, '../../.local/toolchain');

const lockText = await readFile(lockPath, 'utf8');
const lock = JSON.parse(lockText) as {
  gcc: { 'avr-gcc': string; apt: string[] };
  core: GitSource;
  libraries: Source[];
};

const stampOf = (s: Source): string => ('git' in s ? s.commit : s.sha256);

function checkGcc(): void {
  let version: string;
  try {
    version = execFileSync('avr-gcc', ['-dumpversion'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`avr-gcc not found. Install it: sudo apt install -y ${lock.gcc.apt.join(' ')}`);
  }
  if (version !== lock.gcc['avr-gcc'])
    throw new Error(`avr-gcc ${version} found, ${lock.gcc['avr-gcc']} pinned (toolchain.lock.json)`);
  console.warn(`avr-gcc ${version} ✓`);
}

async function fetchGit(src: GitSource, dest: string): Promise<void> {
  const tmp = `${dest}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', src.version, src.git, tmp], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_PARAMETERS: "'advice.detachedHead=false'" },
  });
  const head = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== src.commit)
    throw new Error(`${src.name}@${src.version}: tag points at ${head}, pinned ${src.commit}`);
  await rm(join(tmp, '.git'), { recursive: true, force: true });
  await rm(dest, { recursive: true, force: true });
  await rename(tmp, dest);
}

async function fetchTarball(src: TarballSource, dest: string): Promise<void> {
  const res = await fetch(src.tarball);
  if (!res.ok) throw new Error(`${src.name}: GET ${src.tarball} → ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== src.sha256) throw new Error(`${src.name}@${src.version}: sha256 ${sha}, pinned ${src.sha256}`);
  const tmp = `${dest}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const archive = join(tmp, '..', `${src.name}.tar.gz`);
  await writeFile(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', tmp]);
  await rm(archive);
  await rm(dest, { recursive: true, force: true });
  await rename(tmp, dest);
}

async function ensure(src: Source, dest: string): Promise<void> {
  const stampFile = join(dest, '.robosim-pin');
  if (existsSync(stampFile) && (await readFile(stampFile, 'utf8')) === stampOf(src)) {
    console.warn(`${src.name}@${src.version} ✓ (cached)`);
    return;
  }
  console.warn(`${src.name}@${src.version} … fetching`);
  if ('git' in src) await fetchGit(src, dest);
  else await fetchTarball(src, dest);
  await writeFile(stampFile, stampOf(src));
  console.warn(`${src.name}@${src.version} ✓`);
}

try {
  checkGcc();
  await mkdir(join(toolchainDir, 'libraries'), { recursive: true });
  await ensure(lock.core, join(toolchainDir, 'core'));
  for (const lib of lock.libraries) await ensure(lib, join(toolchainDir, 'libraries', lib.name));
  // The compiler refuses a toolchain dir whose lock differs from its own (stale setup).
  await writeFile(join(toolchainDir, 'toolchain.lock.json'), lockText);
  console.warn(`toolchain ready in ${toolchainDir}`);
} catch (e) {
  console.error(`compiler:setup failed: ${(e as Error).message}`);
  process.exit(1);
}
