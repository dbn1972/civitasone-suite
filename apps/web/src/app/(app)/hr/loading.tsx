import { SkeletonTable } from "../../_components/ds";

/**
 * Route-level loading shell for all /hr/** pages.
 *
 * Uses the design-system SkeletonTable so the shimmer matches
 * the actual page shape (4 stat cards + filter bar + data rows)
 * and inherits the correct CSS-variable theming and sk-shimmer animation.
 * Replaces the previous raw Tailwind animate-pulse approach.
 */
export default function HRLoading() {
  return (
    <main className="page-main wrap" aria-label="Loading…" aria-busy="true">
      <SkeletonTable rows={8} />
    </main>
  );
}
