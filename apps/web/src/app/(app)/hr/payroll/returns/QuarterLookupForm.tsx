/**
 * Server-safe (no JS required) FY + quarter lookup — a plain GET form that
 * re-navigates this page with ?fy=YYYY-YY&quarter=Qn, letting the server
 * component re-fetch Form-24Q/26Q for that period.
 */
export function QuarterLookupForm({
  defaultFy,
  defaultQuarter,
  quarters,
}: {
  defaultFy: string;
  defaultQuarter: string;
  quarters: readonly string[];
}) {
  return (
    <form method="GET" style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor="ret-fy" style={{ fontSize: 13, fontWeight: 600 }}>
          Financial Year
        </label>
        <input
          id="ret-fy"
          name="fy"
          defaultValue={defaultFy}
          pattern="\d{4}-\d{2}"
          placeholder="2025-26"
          aria-describedby="ret-fy-hint"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, width: 140 }}
        />
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor="ret-quarter" style={{ fontSize: 13, fontWeight: 600 }}>
          Quarter
        </label>
        <select
          id="ret-quarter"
          name="quarter"
          defaultValue={defaultQuarter}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
        >
          {quarters.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn ghost" style={{ minHeight: 44 }}>
        View returns
      </button>
      <span id="ret-fy-hint" style={{ fontSize: 12, color: "#667085" }}>
        Format YYYY-YY, e.g. 2025-26
      </span>
    </form>
  );
}
