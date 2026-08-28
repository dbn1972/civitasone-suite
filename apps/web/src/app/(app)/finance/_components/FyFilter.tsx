"use client";

/**
 * FyFilter — replaces the dead "FY 20xx-xx ▾" header button with a real,
 * keyboard-accessible fiscal-year picker. Selecting a year updates the `fy`
 * URL search param (a genuine navigation) and refreshes server data.
 *
 * NOTE: the finance list loaders do not yet accept an `fy` filter, so the
 * selection is currently surfaced as URL state. Once the loaders honour
 * `searchParams.fy`, the filtered data will follow automatically.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { recentFinancialYears } from "@/lib/fiscalYear";

export function FyFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const options = recentFinancialYears();
  const current = params.get("fy") ?? options[0];

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(params.toString());
    next.set("fy", e.target.value);
    router.push(`?${next.toString()}`);
    router.refresh();
  }

  return (
    <label className="btn ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="sr-only">Financial year</span>
      <select
        aria-label="Financial year"
        value={current}
        onChange={onChange}
        style={{ border: "none", background: "transparent", font: "inherit", color: "inherit", cursor: "pointer" }}
      >
        {options.map((fy) => (
          <option key={fy} value={fy}>{`FY ${fy}`}</option>
        ))}
      </select>
    </label>
  );
}
