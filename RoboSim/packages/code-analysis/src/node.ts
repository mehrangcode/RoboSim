import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { CodeAnalysisWasm } from './index.js';

const require = createRequire(import.meta.url);

/** The WASM modules read from node_modules (grader, tests, scripts). */
export function nodeCodeAnalysisWasm(): CodeAnalysisWasm {
  return {
    runtime: readFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm')),
    cpp: readFileSync(require.resolve('tree-sitter-cpp/tree-sitter-cpp.wasm')),
  };
}
