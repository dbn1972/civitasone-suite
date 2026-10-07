import { SkeletonTable } from "../../_components/ds";

// GAP-AI-HOME-04: the previous skeleton used fixed Tailwind light colours
// (bg-slate-50/bg-white/bg-gray-200) and min-h-screen, so it rendered light in
// .dark mode and double-padded inside the app shell. The DS SkeletonTable uses
// the design-system CSS variables (--line/--line2/--panel) so the shimmer
// respects theming, and carries no page background or min-height of its own.
export default function AiLoading() {
  return <SkeletonTable rows={6} />;
}
