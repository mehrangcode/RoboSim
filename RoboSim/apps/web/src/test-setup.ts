import '@robosim/ui/testing/setup';
import { vi } from 'vitest';

// Monaco needs a real browser (layout, workers): under jsdom the plain editor stays in place.
vi.mock('./code-editor/monaco-loader.js', () => ({ loadMonacoEditor: () => new Promise(() => undefined) }));

// Loading a project runs the code-aware safety rules, which need the tree-sitter parser.
const { initCodeAnalysis } = await import('@robosim/code-analysis');
const { nodeCodeAnalysisWasm } = await import('@robosim/code-analysis/node');
await initCodeAnalysis(nodeCodeAnalysisWasm());

// The onboarding tour opens on a first visit (FR-WRK-06); tests that cover it remove this flag.
const { beforeEach } = await import('vitest');
beforeEach(() => localStorage.setItem('robosim.editor.tourDone', 'test'));
