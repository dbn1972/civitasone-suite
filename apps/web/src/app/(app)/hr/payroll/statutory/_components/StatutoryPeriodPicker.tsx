"use client";

import { useRouter } from "next/navigation";
import { formatPeriod } from "@/lib/formatters";

/**
 * GAP-PAYROLL-STATUTORY-PF-03 / GAP-PAYROLL-STATUTORY-ESI-03: a small shared
 * period picker for statutory ledger pages (PF, ESI) whose totals must be
 * scoped to one filing period rather than silently summed across every
 * period the backend happens to return. Generalises
 * challans/PeriodSelector.tsx's "push a new ?period= and let the Server
 * Component refetch" pattern to a <select> of only the periods actually
 * present in the data (a ledger's periods are a closed, known set — unlike
 * challans' free-form month-to-ingest, there is nothing to "type").
 */
export function StatutoryPeriodPicker({
  periods,
  selected,
  basePath,
  label,
}: {
  periods: string[];
  selected: string | undefined;
  basePath: string;
  label: string;
}) {
  const router = useRouter();
  if (periods.length === 0) return null;

  return (
    <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
      <label htmlFor="statutory-period-picker" style={{ fontSize: 13, fontWeight: 600 }}>
        {label}
      </label>
      <select
        id="statutory-period-picker"
        value={selected ?? ""}
        onChange={(e) => router.push(`${basePath}?period=${encodeURIComponent(e.target.value)}`)}
        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40, background: "var(--panel)", color: "var(--ink)" }}
      >
        {periods.map((p) => (
          <option key={p} value={p}>
            {formatPeriod(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
