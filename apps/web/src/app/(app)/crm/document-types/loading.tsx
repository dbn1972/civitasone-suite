/**
 * GAP-CRM-DOCUMENT-TYPES-05: the loaded page is a PageHeader over a single card
 * whose body is a list of stacked definition rows — NOT a grid of stat tiles.
 * The old skeleton painted four 80px tiles + a 280px block, so the layout
 * jumped when the real card list arrived. This mirrors the real structure: a
 * header placeholder, then one card with three ~180px row blocks, using the
 * design-system line token (not a raw hex) so it is theme-correct.
 */
export default function Loading() {
  return (
    <div className="page-main" aria-busy="true">
      <div className="ph">
        <div style={{ display: "grid", gap: 8 }}>
          <h1 id="page-heading">Document Types</h1>
          <div style={{ height: 14, width: 320, borderRadius: 6, background: "var(--line2)" }} />
        </div>
      </div>
      <div className="card animate-pulse">
        <div className="card-h">
          <div style={{ height: 16, width: 160, borderRadius: 6, background: "var(--line2)" }} />
        </div>
        <div className="pad" style={{ display: "grid", gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 180, borderRadius: 12, background: "var(--line2)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
