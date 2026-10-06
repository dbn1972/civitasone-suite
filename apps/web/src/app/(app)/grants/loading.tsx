import { SkeletonTable } from "@/app/_components/ds/Skeleton";

/**
 * GAP-GRANTS-HOME-04: the old skeleton hard-coded `min-h-screen bg-slate-50`
 * + `bg-slate-200` blocks, so it stayed light in dark mode and double-padded
 * inside the app shell. Reuse the shared, theme-token-based SkeletonTable
 * (var(--panel)/--line via Skeleton.tsx) which renders no page-level
 * background or min-height wrapper, so it inherits the shell padding.
 */
export default function GrantsLoading() {
  return <SkeletonTable rows={8} />;
}
