/** Monaco's own chunk (~1 MB); tests replace this module so the plain editor stays in place. */
export const loadMonacoEditor = () => import('./monaco-editor.js').then((m) => m.MonacoEditor);
