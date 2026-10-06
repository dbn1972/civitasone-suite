import { SkeletonTable } from "@/app/_components/ds";

// GAP-AUDIT-INVESTIGATION-06: match the final layout (PageHeader + 4 stat cards
// + table) so there is no layout shift when the data resolves.
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading investigations…">
      <div className="skeleton" style={{ height: 56, maxWidth: 420, marginBottom: 18 }} aria-hidden="true" />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 92 }} aria-hidden="true" />
        ))}
      </div>
      <div className="card">
        <div className="card-h"><h3>Investigation Cases</h3></div>
        <div className="pad">
          <SkeletonTable rows={8} />
        </div>
      </div>
    </div>
  );
}
