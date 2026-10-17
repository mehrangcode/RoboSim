import '@robosim/ui/testing/setup';
import { vi } from 'vitest';

// Monaco needs a real browser (layout, workers): under jsdom the plain editor stays in place.
vi.mock('./code-editor/monaco-loader.js', () => ({ loadMonacoEditor: () => new Promise(() => undefined) }));
