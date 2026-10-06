import { SkeletonCard } from "@/app/_components/ds";

/**
 * GAP-POLICY-HOME-03: a shimmer tile skeleton (matching the plugins hub and the
 * ds Skeleton* components) instead of the bare "Loading policy…" paragraph, so
 * the hub shows no layout jump while loading.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading Policy">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
