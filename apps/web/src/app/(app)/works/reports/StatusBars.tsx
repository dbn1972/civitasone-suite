import { humanizeStatus } from "@/lib/formatters";

/**
 * GAP-WORKS-REPORTS-07: a compact horizontal bar chart of works by status, so the reporting screen has a chart and
 * not only tables. Pure CSS bars (server-safe, no chart library); the exact numbers stay in the table below, and the
 * whole figure carries a text alternative for assistive tech.
 */
export function StatusBars({ items, ariaLabel }: { items: { status: string; count: number }[]; ariaLabel: string }) {
  const rows = items.filter((i) => i.count > 0);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.count));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <figure role="img" aria-label={`${ariaLabel}: ${rows.map((r) => `${humanizeStatus(r.status)} ${r.count}`).join(", ")}`} style={{ margin: "0 0 16px" }}>
      <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.status} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr 56px", alignItems: "center", gap: 10, fontSize: 13 }}>
            <span style={{ color: "var(--ink)" }}>{humanizeStatus(r.status)}</span>
            <span style={{ background: "var(--surface)", borderRadius: 6, height: 14, overflow: "hidden" }}>
              <span
                data-testid="status-bar"
                style={{ display: "block", height: "100%", width: `${Math.max(2, Math.round((r.count / max) * 100))}%`, background: "var(--primary)", borderRadius: 6 }}
              />
            </span>
            <span style={{ textAlign: "end", color: "var(--muted)" }}>
              {r.count} ({Math.round((r.count / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}
