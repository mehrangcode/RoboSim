// Shared DOM test setup for packages using Vitest + Testing Library.
import '@testing-library/jest-dom/vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jest-dom 7.0.1 augments `Assertion<T>`, but Vitest 5 declares `Assertion<R, T>`, so its typings do not merge
// (hidden by skipLibCheck). Augment Vitest's `Matchers<R, T>` instead. Remove once jest-dom supports Vitest 5.
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- declaration merge must repeat Vitest's type parameters */
declare module 'vitest' {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<unknown, R> {}
}
/* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // Not every test environment provides storage.
  }
});
