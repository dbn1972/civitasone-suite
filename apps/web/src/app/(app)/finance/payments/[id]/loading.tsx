import { SkeletonBar, SkeletonCard } from "@/app/_components/ds/Skeleton";

/**
 * GAP-FINANCE-PAYMENTS-DETAIL-05: detail-shaped skeleton (breadcrumb + title bars,
 * four stat blocks, one details card) -- the inherited payments/loading.tsx is the
 * register's (four cards + a 384px table block), which shifted when the detail loaded.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" role="status" aria-live="polite" aria-label="Loading payment…">
      <div style={{ marginBottom: 24 }}>
        <SkeletonBar w={220} h={14} style={{ marginBottom: 12 }} />
        <SkeletonBar w={280} h={30} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <SkeletonBar h={220} style={{ marginTop: 18, borderRadius: 12 }} />
    </div>
  );
}
