import { minorToRupeesOrNull } from "@/lib/formatters";

/**
 * UX-018: estimatedValueMinor is always a real number in this form by construction
 * (local state seeded by emptyLine()/updateLine(), never hydrated from a fetched
 * row), so this is defensive rather than fixing a currently-reachable bug. Guard via
 * the shared type guard anyway instead of a bare `/ 100`, matching the convention at
 * every other *Minor call site — so this input can't start rendering NaN if a future
 * edit ever pre-fills lines from an API response. 0 (not "—") is the right fallback:
 * it's an editable numeric input, not a read-only display, and 0 is already
 * emptyLine()'s own starting value.
 *
 * Lives in its own module rather than being exported from page.tsx: Next.js's App
 * Router only allows a fixed set of named exports from a page file and rejects the
 * build otherwise ("<name> is not a valid Page export field").
 */
export function estimatedValueRupees(minor: number | null | undefined): number {
  return minorToRupeesOrNull(minor) ?? 0;
}
