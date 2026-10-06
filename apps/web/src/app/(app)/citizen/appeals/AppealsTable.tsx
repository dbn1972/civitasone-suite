"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import type { AppealSummary } from "../../../_data/citizenPartials";

type AppealRow = {
  id: string;
  appealType: string;
  grounds: string;
  filingDeadline: string;
  status: string;
  outcome: string;
} & Record<string, unknown>;

/**
 * GAP-CITIZEN-APPEALS-05: replaces the hand table (no filter/sort/pagination,
 * grounds truncated with no way to read it) with the ds DataTable — sortable,
 * filterable, pageSize 15, like citizen/alerts. GAP-CITIZEN-APPEALS-06: type
 * and status are humanized ('under_review' → 'Under Review') instead of raw
 * codes, and the deadline is formatted dd Mon yyyy.
 */
export function AppealsTable({ appeals }: { appeals: AppealSummary[] }) {
  const t = useTranslations("citizenAppeals");

  const rows = useMemo<AppealRow[]>(
    () =>
      appeals.map((a) => ({
        id: a.id,
        appealType: humanizeStatus(a.appealType),
        grounds: a.grounds,
        filingDeadline: formatIndianDate(a.filingDeadline),
        status: a.status,
        outcome: a.outcome ? humanizeStatus(a.outcome) : "—",
      })),
    [appeals],
  );

  return (
    <DataTable<AppealRow>
      rows={rows}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
      columns={[
        { key: "appealType", label: t("colType") },
        { key: "grounds", label: t("colGrounds") },
        { key: "filingDeadline", label: t("colDeadline") },
        { key: "status", label: t("colStatus"), cellType: "status" },
        { key: "outcome", label: t("colOutcome") },
      ]}
    />
  );
}
