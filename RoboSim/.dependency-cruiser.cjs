/** Architecture boundaries from Technical Design §3.1. `pnpm arch:check` fails CI on violations. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sim-core-is-pure',
      comment:
        'sim-core must run in a worker, in Node, and in tests: no DOM, React, renderers, or Node built-ins.',
      severity: 'error',
      from: { path: '^packages/sim-core/' },
      to: {
        path: ['node_modules/(react|react-dom|three|@react-three)/', '^packages/renderer-', '^apps/'],
        dependencyTypes: ['npm', 'local', 'core'],
      },
    },
    {
      name: 'sim-core-no-node-builtins',
      comment: 'sim-core runs unchanged in a browser worker: node:* / fs / path etc. are forbidden.',
      severity: 'error',
      from: { path: '^packages/sim-core/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'extensions-are-isolated',
      comment: 'Boards, components, and safety rules depend only on sim-core and shared.',
      severity: 'error',
      from: { path: '^packages/(boards|components|safety-rules)/([^/]+)/' },
      to: { path: ['^apps/', '^packages/renderer-', '^packages/(boards|components|safety-rules)/(?!$2)'] },
    },
    {
      name: 'renderers-consume-snapshots-only',
      severity: 'error',
      from: { path: '^packages/renderer-' },
      to: { path: '^packages/sim-core/src/(?!snapshot)' },
    },
    {
      name: 'browser-never-imports-server-code',
      severity: 'error',
      from: { path: '^(apps/(web|admin)|packages/(ui|sim-core|renderer-[^/]+|circuit-canvas))/' },
      to: { path: ['^apps/(api|compiler|grader|exporter|realtime)/', '^packages/ai-providers/'] },
    },
    {
      name: 'browser-never-bundles-guided-content',
      comment: 'Guided projects are gated by plan (ADR-006): browsers get them from the API only.',
      severity: 'error',
      from: { path: '^(apps/(web|admin)|packages/(ui|sim-core|sim-runtime|renderer-[^/]+|circuit-canvas))/' },
      to: { path: '^packages/content/(src|dist)/guided/' },
    },
    {
      name: 'api-modules-use-public-entrypoints',
      comment: "Modules talk through each other's index.ts only (Technical Design §7.1).",
      severity: 'error',
      from: { path: '^apps/api/src/modules/([^/]+)/' },
      to: { path: '^apps/api/src/modules/(?!$1/)[^/]+/(?!index\\.ts$)' },
    },
    {
      name: 'packages-do-not-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)dist/', '(^|/)coverage/', '\\.test\\.tsx?$', '(^|/)test/'] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      extensions: ['.ts', '.tsx', '.js'],
    },
  },
};
