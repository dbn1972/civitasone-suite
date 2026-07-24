// Wires @testing-library/jest-dom matchers into Vitest's `expect` for TYPE checking.
// (The runtime side-effect import lives in vitest.setup.ts.)
//
// Vitest's `Assertion` is re-exported from `@vitest/expect`, and jest-dom's own
// `declare module '@vitest/expect'` augmentation does not merge here because
// `@vitest/expect` is not resolvable from apps/web under this pnpm layout (two
// @vitest/expect copies exist, so the specifier shadows instead of merging).
// Instead we augment the global `Chai.Assertion` interface — the same seam
// Vitest itself extends (e.g. `containSubset`). Vitest's `Assertion<T>` extends
// `Chai.Assertion`, so every matcher added here is visible on `expect(...)`.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Chai {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface Assertion extends TestingLibraryMatchers<any, void> {}
  }
}

export {};
