import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import i18next from 'eslint-plugin-i18next';
import noPhysicalDirectionClasses from './rules/no-physical-direction-classes.js';

export const robosimPlugin = {
  meta: { name: 'robosim' },
  rules: { 'no-physical-direction-classes': noPhysicalDirectionClasses },
};

const ignores = {
  ignores: ['**/dist/**', '**/coverage/**', '**/routeTree.gen.ts', '**/drizzle/migrations/**'],
};

/** Shared TypeScript rules for every package. */
export const base = tseslint.config(ignores, js.configs.recommended, ...tseslint.configs.strict, {
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
});

/** Node services and libraries. */
export const node = tseslint.config(...base, {
  languageOptions: { globals: globals.node },
});

/** React applications: hooks rules, RTL-safe classes, and no hard-coded user-facing strings (FR-I18N-03). */
export const react = tseslint.config(
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      i18next,
      robosim: robosimPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'robosim/no-physical-direction-classes': 'error',
      'i18next/no-literal-string': [
        'error',
        { mode: 'jsx-only', 'jsx-attributes': { include: ['title', 'aria-label', 'alt', 'placeholder'] } },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**'],
    rules: { 'i18next/no-literal-string': 'off' },
  },
);
