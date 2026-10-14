import { node } from '@robosim/config/eslint';

export default [
  ...node,
  {
    rules: {
      // Nest modules are decorated empty classes by design.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // Nest resolves constructor dependencies from emitted type metadata, so injected classes must stay value
    // imports; the auto-fixer would otherwise turn them into `import type` and break DI at runtime.
    files: [
      'src/**/*.module.ts',
      'src/**/*.controller.ts',
      'src/**/*.service.ts',
      'src/**/*.filter.ts',
      'src/**/*.relay.ts',
    ],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
];
