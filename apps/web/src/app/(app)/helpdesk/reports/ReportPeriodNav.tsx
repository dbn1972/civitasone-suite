"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Segmented } from "../../../_components/ds";

export type ReportPeriod = "mtd" | "qtd" | "fy";

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  mtd: "Month-to-date",
  qtd: "Quarter-to-date",
  fy: "Financial year",
};

const OPTIONS = Object.values(PERIOD_LABELS);
const VALUES = Object.keys(PERIOD_LABELS) as ReportPeriod[];

/**
 * GAP-HELPDESK-REPORTS-01: searchParams-driven period control. Selecting a
 * period navigates to ?period=<value>, triggering a server refetch with the
 * new period. citizen-service's analytics endpoint filters on it (MTD / QTD /
 * FY, Indian fiscal calendar, by ticket creation date).
 */
export function ReportPeriodNav({ current }: { current: ReportPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(label: string) {
    const idx = OPTIONS.indexOf(label);
    if (idx < 0) return;
    const next = VALUES[idx]!;
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Segmented
        options={OPTIONS}
        value={PERIOD_LABELS[current]}
        onChange={handleChange}
      />
    </div>
  );
}
