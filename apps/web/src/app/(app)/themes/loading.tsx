import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

// GAP-THEMES-HOME-03: the generic 4-stat + block skeleton did not match the
// five-tile hub (and used a bespoke slate full-screen wrapper). Mirror the
// loaded page: a header bar + a 3-column grid of five tile placeholders inside
// the standard .page-main wrapper, with an accessible busy label.
export default function ThemesLoading() {
  return (
    <div className="page-main" aria-busy="true" aria-labelledby="themes-loading-label">
      <span id="themes-loading-label" className="sr-only">Loading themes…</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        <SkeletonBar w={160} h={28} />
        <SkeletonBar w={360} h={14} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
