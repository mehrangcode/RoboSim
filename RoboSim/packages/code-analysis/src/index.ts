import type { CodeFacts } from '@robosim/sim-core';
import { Language, Parser } from 'web-tree-sitter';
import { extractPinUsage, type SourceFile } from './extract.js';

export type { SourceFile } from './extract.js';

/** Where the two WASM modules come from: a URL (browser) or their bytes (Node). */
export interface CodeAnalysisWasm {
  /** `web-tree-sitter.wasm`, the parser runtime. */
  readonly runtime: string | Uint8Array;
  /** `tree-sitter-cpp.wasm`, the C++ grammar. */
  readonly cpp: string | Uint8Array;
}

let parser: Parser | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the tree-sitter runtime and the C++ grammar (once; later calls share the first load). Runs and
 * grading are synchronous, so every host awaits this before loading a project.
 */
export function initCodeAnalysis(wasm: CodeAnalysisWasm): Promise<void> {
  loading ??= (async () => {
    const { runtime, cpp } = wasm;
    // Bytes are copied into this realm's Uint8Array: a Node Buffer fails web-tree-sitter's instanceof
    // check under jsdom and would be taken for a file path.
    await Parser.init(
      typeof runtime === 'string'
        ? { locateFile: () => runtime }
        : { wasmBinary: new Uint8Array(runtime).buffer },
    );
    const p = new Parser();
    p.setLanguage(await Language.load(typeof cpp === 'string' ? cpp : new Uint8Array(cpp)));
    parser = p;
  })().catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

export const isCodeAnalysisReady = (): boolean => parser !== null;

/** Pin usage of a sketch (FR-COD-06). Throws until `initCodeAnalysis` has resolved. */
export function analyzeSketch(files: readonly SourceFile[]): CodeFacts {
  if (!parser) throw new Error('code analysis is not initialised: await initCodeAnalysis() first');
  return extractPinUsage(parser, files);
}
