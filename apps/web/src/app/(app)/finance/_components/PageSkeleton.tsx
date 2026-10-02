import { SkeletonBar, SkeletonCard, SkeletonRow, StatGrid } from "../../../_components/ds";

/**
 * Route-level loading skeleton that mirrors a finance list page: header,
 * stat cards, an optional form/selector card, then a table card. Keeps the
 * same `page-main wrap` shell as the page so nothing shifts when it loads
 * (GAP-FINANCE-FISCAL-YEARS-04, GAP-FINANCE-GST-07).
 */
export function PageSkeleton({
  label,
  statCards,
  formFields = 0,
  formFirst = false,
  rows = 6,
}: {
  /** Accessible name announced while loading. */
  label: string;
  statCards: number;
  /** Number of placeholder inputs in the form/selector card (0 = no card). */
  formFields?: number;
  /** Render the form/selector card above the stat cards (GST period selector). */
  formFirst?: boolean;
  rows?: number;
}) {
  const formCard =
    formFields > 0 ? (
      <div className="card pad" style={{ marginBottom: 16 }} aria-hidden="true">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {Array.from({ length: formFields }, (_, i) => (
            <div key={i}>
              <SkeletonBar w="40%" h={12} style={{ marginBottom: 8 }} />
              <SkeletonBar h={44} />
            </div>
          ))}
        </div>
      </div>
    ) : null;
  return (
    <div className="page-main wrap" role="status" aria-live="polite" aria-label={label}>
      <div style={{ marginBottom: 20 }}>
        <SkeletonBar w={120} h={12} style={{ marginBottom: 10 }} />
        <SkeletonBar w={260} h={28} />
      </div>
      {formFirst && formCard}
      <StatGrid>
        {Array.from({ length: statCards }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </StatGrid>
      {!formFirst && formCard}
      <div className="card pad" aria-hidden="true">
        <SkeletonBar w={160} h={16} style={{ marginBottom: 14 }} />
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
