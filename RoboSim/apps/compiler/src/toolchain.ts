import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildBoard } from '@robosim/shared';

/** Bump when compile flags or preprocessing change: it is part of every cache key. */
export const DRIVER_VERSION = 1;

export interface BoardSpec {
  readonly fqbn: string;
  readonly mcu: string;
  readonly defines: readonly string[];
  readonly variant: string;
  readonly maxFlashBytes: number;
  readonly maxRamBytes: number;
}

/** boards.txt `uno.*` (Arduino AVR core 1.8.6); flash excludes the 512 B Optiboot bootloader. */
export const BOARDS: Record<BuildBoard, BoardSpec> = {
  'avr-uno': {
    fqbn: 'arduino:avr:uno',
    mcu: 'atmega328p',
    defines: ['F_CPU=16000000L', 'ARDUINO=10607', 'ARDUINO_AVR_UNO', 'ARDUINO_ARCH_AVR'],
    variant: 'standard',
    maxFlashBytes: 32_256,
    maxRamBytes: 2_048,
  },
};

/** platform.txt compile flags (warnings set per translation unit). */
export const FLAGS = {
  c: [
    '-c',
    '-g',
    '-Os',
    '-std=gnu11',
    '-ffunction-sections',
    '-fdata-sections',
    '-flto',
    '-fno-fat-lto-objects',
  ],
  cpp: [
    '-c',
    '-g',
    '-Os',
    '-std=gnu++11',
    '-fpermissive',
    '-fno-exceptions',
    '-ffunction-sections',
    '-fdata-sections',
    '-fno-threadsafe-statics',
    '-Wno-error=narrowing',
    '-flto',
  ],
  S: ['-c', '-g', '-x', 'assembler-with-cpp', '-flto'],
  link: ['-Os', '-g', '-flto', '-fuse-linker-plugin', '-Wl,--gc-sections'],
  /** Plain, machine-readable diagnostics. */
  diagnostics: ['-fdiagnostics-color=never', '-fno-diagnostics-show-caret', '-fno-diagnostics-show-option'],
} as const;

export interface Library {
  readonly name: string;
  readonly version: string;
  /** Directory added to the include path (`src/` for 1.5-format libraries). */
  readonly includeDir: string;
  /** Source directories compiled into the library archive. */
  readonly sources: readonly string[];
  /** 1.5 format: `src/` is compiled recursively; legacy: root + `utility/`, flat. */
  readonly recursive: boolean;
  /** Headers directly under `includeDir`, which `#include <...>` resolves to this library. */
  readonly headers: readonly string[];
  readonly builtin: boolean;
}

export interface Toolchain {
  readonly dir: string;
  readonly coreDir: string;
  /** Hash of the lock, the gcc build and the driver version; part of every cache key. */
  readonly id: string;
  readonly gccVersion: string;
  readonly libraries: ReadonlyMap<string, Library>;
}

export const DEFAULT_TOOLCHAIN_DIR = fileURLToPath(new URL('../../../.local/toolchain', import.meta.url));
export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../../../.local/compiler-cache', import.meta.url));
const LOCK_PATH = fileURLToPath(new URL('../toolchain.lock.json', import.meta.url));

export class ToolchainError extends Error {
  override name = 'ToolchainError';
}

function readProperties(file: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([\w.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] !== undefined) props[m[1]] = m[2] ?? '';
  }
  return props;
}

function loadLibrary(root: string, builtin: boolean): Library {
  const props = readProperties(join(root, 'library.properties'));
  const modern = existsSync(join(root, 'src'));
  const includeDir = modern ? join(root, 'src') : root;
  const headers = readdirSync(includeDir).filter((f) => /\.(h|hpp)$/.test(f));
  const sources = modern ? [includeDir] : [root, join(root, 'utility')].filter((d) => existsSync(d));
  const name = props.name;
  const version = props.version;
  if (!name || !version) throw new ToolchainError(`${root}: library.properties lacks name/version`);
  return { name, version, includeDir, sources, recursive: modern, headers, builtin };
}

/** Loads and verifies a toolchain fetched by `pnpm compiler:setup`. Fails fast with an actionable message. */
export function loadToolchain(dir = DEFAULT_TOOLCHAIN_DIR): Toolchain {
  const lockText = readFileSync(LOCK_PATH, 'utf8');
  const installedLock = join(dir, 'toolchain.lock.json');
  if (!existsSync(installedLock) || readFileSync(installedLock, 'utf8') !== lockText)
    throw new ToolchainError(`toolchain in ${dir} is missing or stale — run: pnpm compiler:setup`);
  const lock = JSON.parse(lockText) as { gcc: { 'avr-gcc': string } };
  let gccVersion: string;
  let gccBuild: string;
  try {
    gccVersion = execFileSync('avr-gcc', ['-dumpversion'], { encoding: 'utf8' }).trim();
    gccBuild = spawnSync('avr-gcc', ['-v'], { encoding: 'utf8' }).stderr; // `-v` reports on stderr
  } catch {
    throw new ToolchainError(
      'avr-gcc not found — install gcc-avr, avr-libc and binutils-avr (see toolchain.lock.json)',
    );
  }
  if (gccVersion !== lock.gcc['avr-gcc'])
    throw new ToolchainError(`avr-gcc ${gccVersion} found, ${lock.gcc['avr-gcc']} pinned`);

  const coreDir = join(dir, 'core');
  const libraries = new Map<string, Library>();
  const add = (root: string, builtin: boolean): void => {
    if (!statSync(root).isDirectory()) return;
    const lib = loadLibrary(root, builtin);
    libraries.set(lib.name, lib);
  };
  // Core built-ins first (EEPROM, SPI, SoftwareSerial, Wire, HID), then the pinned extras.
  for (const name of readdirSync(join(coreDir, 'libraries')).sort())
    add(join(coreDir, 'libraries', name), true);
  for (const name of readdirSync(join(dir, 'libraries')).sort()) add(join(dir, 'libraries', name), false);

  const id = createHash('sha256')
    .update(lockText)
    .update('\0')
    .update(gccBuild)
    .update(`\0driver${DRIVER_VERSION}\0${JSON.stringify(FLAGS)}`)
    .digest('hex')
    .slice(0, 16);
  return { dir, coreDir, id, gccVersion, libraries };
}

/** Header name → library that provides it (first library wins, built-ins before extras). */
export function headerIndex(toolchain: Toolchain): Map<string, Library> {
  const index = new Map<string, Library>();
  for (const lib of toolchain.libraries.values())
    for (const h of lib.headers) if (!index.has(h)) index.set(h, lib);
  return index;
}
