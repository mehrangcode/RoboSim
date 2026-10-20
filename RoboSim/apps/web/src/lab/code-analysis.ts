import { initCodeAnalysis } from '@robosim/code-analysis';
import cpp from '@robosim/code-analysis/tree-sitter-cpp.wasm?url';
import runtime from '@robosim/code-analysis/web-tree-sitter.wasm?url';

/**
 * The tree-sitter parser for the code-aware safety rules (FR-COD-06), started when a worker imports
 * this. Both WASM files are fetched lazily, outside the initial bundle.
 */
export const codeAnalysisReady = initCodeAnalysis({ runtime, cpp });
