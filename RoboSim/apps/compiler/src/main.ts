#!/usr/bin/env node
// Build CLI (Technical Design §6): sketch files → Intel HEX + diagnostics, through the same pipeline as the API.
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { BUILD_BOARDS, buildRequestSchema } from '@robosim/shared';
import { Compiler } from './compiler.js';
import { DEFAULT_CACHE_DIR, ToolchainError } from './toolchain.js';

const USAGE = `Usage: robosim-compile <main.ino> [more files…] [--board ${BUILD_BOARDS.join('|')}] [--out firmware.hex] [--json]

  The first .ino file is the main sketch; .h/.hpp/.c/.cpp files and extra .ino tabs are added as given.
  --out          Write the HEX here (default: print nothing but the summary).
  --json         Print the full result as JSON.
  --cache-dir    Content-addressed cache (default ${DEFAULT_CACHE_DIR}).
  --no-sandbox   Trusted sources only: skip the namespace sandbox.

Exit codes: 0 built, 1 the sketch has errors, 2 usage or toolchain error.`;

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export async function main(argv: readonly string[], io: Io): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        board: { type: 'string', default: 'avr-uno' },
        out: { type: 'string' },
        json: { type: 'boolean' },
        'cache-dir': { type: 'string', default: DEFAULT_CACHE_DIR },
        'no-sandbox': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }
  if (args.values.help || args.positionals.length === 0) {
    (args.values.help ? io.out : io.err)(`${USAGE}\n`);
    return args.values.help ? 0 : 2;
  }
  try {
    const files = await Promise.all(
      args.positionals.map(async (p) => ({ name: basename(p), content: await readFile(p, 'utf8') })),
    );
    const parsed = buildRequestSchema.safeParse({ board: args.values.board, files, libraries: [] });
    if (!parsed.success) {
      io.err(
        `invalid build: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}\n`,
      );
      return 2;
    }
    const compiler = await Compiler.create({
      cacheDir: args.values['cache-dir'],
      sandbox: !args.values['no-sandbox'],
    });
    const result = await compiler.build(parsed.data);
    const hex = result.artifact ? await compiler.readArtifact(result.artifact.sha256) : undefined;
    if (args.values.out && hex !== undefined) await writeFile(args.values.out, hex);
    if (args.values.json) {
      io.out(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      for (const d of result.diagnostics)
        io.out(
          `${d.file ? `${d.file}:${d.line}:${d.column}: ` : ''}${d.severity}: ${d.message}${d.explanationKey ? ` [${d.explanationKey}]` : ''}\n`,
        );
      const size = result.artifact?.size;
      io.out(
        size
          ? `built: flash ${size.flashBytes} B (${size.flashPct}%), RAM ${size.ramBytes} B (${size.ramPct}%)${result.cacheHit ? ', cached' : ''} in ${Math.round(result.durationMs)} ms\n`
          : `build failed\n`,
      );
    }
    return result.status === 'succeeded' ? 0 : 1;
  } catch (e) {
    io.err(`${e instanceof ToolchainError ? '' : 'internal error: '}${(e as Error).message}\n`);
    return 2;
  }
}

if (import.meta.main)
  process.exitCode = await main(process.argv.slice(2), {
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
  });
