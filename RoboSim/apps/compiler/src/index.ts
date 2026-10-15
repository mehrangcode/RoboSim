export { Compiler, mainSketch, normalizeFiles, sizeReport } from './compiler.js';
export type { CompileOutput, CompilerOptions, SizeReport } from './compiler.js';
export { EXPLANATION_KEYS, explain } from './explanations.js';
export { parseDiagnostics } from './diagnostics.js';
export { preprocessSketch } from './preprocess.js';
export {
  BOARDS,
  DEFAULT_CACHE_DIR,
  DEFAULT_TOOLCHAIN_DIR,
  loadToolchain,
  ToolchainError,
} from './toolchain.js';
export type { Toolchain } from './toolchain.js';
