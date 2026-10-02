"use client";

/**
 * FyFilter — replaces the dead "FY 20xx-xx ▾" header button with a real,
 * keyboard-accessible fiscal-year picker. Selecting a year updates the `fy`
 * URL search param (a genuine navigation) and refreshes server data.
 *
 * Pages that render this control (dashboard, budget/formulation,
 * budget/monitoring) read `searchParams.fy` server-side and pass the validated
 * FY to their loaders, so the push below re-renders them with the new year.
 * (Financial statements are cumulative and do not use it.)
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
