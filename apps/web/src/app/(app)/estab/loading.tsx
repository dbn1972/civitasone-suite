import { TileHubSkeleton } from "@/app/_components/ds";

// GAP-ESTABLISHMENT-HOME-02: previously hand-rolled Tailwind bg-slate-200
// blocks with animate-pulse, which ignore the design-system theme and render
// as bright gray in dark mode. TileHubSkeleton uses the ds CSS-variable shimmer
// (--line/--line2/--panel) so it tracks light/dark theming, and mirrors the
// /estab ModuleHub layout (header + tile grid) rather than a generic stat page.
export default function EstabLoading() {
  return (
    <div className="p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <TileHubSkeleton />
      </div>
    </div>
  );
}
