/**
 * GAP-CRM-DOCUMENT-TYPES-05 / GAP-CRM-DOCUMENTS-04: the loaded Documents page is
 * a PageHeader (title + subtitle) over the cross-record register card and a
 * guidance card — no stat tiles. The old skeleton drew four 80px tiles + a
 * 280px block, so a tile grid flashed before the real cards. This mirrors the
 * real structure (header with subtitle, a register-shaped card, a text card)
 * using the design-system line token so there is no tile flash or CLS jump.
 */
export default function Loading() {
  return (
    <div className="page-main" aria-busy="true">
      <div className="ph">
        <div style={{ display: "grid", gap: 8 }}>
          <h1 id="page-heading">Documents</h1>
          <div style={{ height: 14, width: 360, borderRadius: 6, background: "var(--line2)" }} />
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        {/* Register card: a filter row + a table block. */}
        <div className="card">
          <div className="pad" style={{ display: "grid", gap: 12 }}>
            <div style={{ height: 36, width: "60%", borderRadius: 8, background: "var(--line2)" }} />
            <div style={{ height: 220, borderRadius: 12, background: "var(--line2)" }} />
          </div>
        </div>
        {/* Guidance text card: a few text lines + a button row. */}
        <div className="card">
          <div className="pad" style={{ display: "grid", gap: 10 }}>
            <div style={{ height: 14, borderRadius: 6, background: "var(--line2)" }} />
            <div style={{ height: 14, width: "85%", borderRadius: 6, background: "var(--line2)" }} />
            <div style={{ height: 14, width: "70%", borderRadius: 6, background: "var(--line2)" }} />
            <div style={{ height: 40, width: 220, borderRadius: 8, background: "var(--line2)", marginTop: 4 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
