/**
 * Server-safe (no JS required) financial-year lookup — a plain GET form that
 * re-navigates this page with ?fy=YYYY-YY, letting the server component below
 * re-fetch the bulk-status job for that year. There is no "list all jobs"
 * endpoint, so this is the FY-scoped substitute for a table.
 */
export function FyLookupForm({ defaultFy }: { defaultFy: string }) {
  return (
    <form method="GET" style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor="fy-lookup" style={{ fontSize: 13, fontWeight: 600 }}>
          Financial Year
        </label>
        <input
          id="fy-lookup"
          name="fy"
          defaultValue={defaultFy}
          pattern="\d{4}-\d{2}"
          placeholder="2025-26"
          aria-describedby="fy-lookup-hint"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, width: 140 }}
        />
      </div>
      <button type="submit" className="btn ghost" style={{ minHeight: 44 }}>
        Check run
      </button>
      <span id="fy-lookup-hint" style={{ fontSize: 12, color: "var(--mut)" }}>
        Format YYYY-YY, e.g. 2025-26
      </span>
    </form>
  );
}
