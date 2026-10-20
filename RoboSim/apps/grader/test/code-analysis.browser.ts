import { initCodeAnalysis } from '@robosim/code-analysis';
import cpp from '@robosim/code-analysis/tree-sitter-cpp.wasm?url';
import runtime from '@robosim/code-analysis/web-tree-sitter.wasm?url';

/** The tree-sitter parser for the code-aware safety rules, loaded by URL as the web app does. */
export const codeAnalysisReady = initCodeAnalysis({ runtime, cpp });
