// Ships the tree-sitter runtime and C++ grammar next to the build so browsers can load them by URL
// (`@robosim/code-analysis/tree-sitter-cpp.wasm?url`); package exports cannot point into node_modules.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = new URL('../dist/wasm/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const spec of ['web-tree-sitter/web-tree-sitter.wasm', 'tree-sitter-cpp/tree-sitter-cpp.wasm'])
  copyFileSync(require.resolve(spec), new URL(spec.split('/')[1] ?? '', out));
