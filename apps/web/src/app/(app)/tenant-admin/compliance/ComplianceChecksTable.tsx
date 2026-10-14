"use client";

import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import type { ComplianceCheck } from "@/app/_data/loaders";

type Row = ComplianceCheck & Record<string, unknown>;

/**
 * GAP-TENANT-ADMIN-COMPLIANCE-04: the recent-checks list as a sortable, paginated
 * table (the old <ol> with inline styles rendered every check at once and could
 * not be paged or sorted). GAP-TENANT-ADMIN-COMPLIANCE-02: each check shows how
 * many evidence items back it; "None recorded" is stated plainly rather than
 * implied by an empty cell.
 */
export function ComplianceChecksTable({ checks }: { checks: ComplianceCheck[] }) {
  const t = useTranslations("tenantAdminW2.compliance");
  return (
    <DataTable<Row>
      caption={t("checksCaption")}
      columns={[
        { key: "title", label: t("colCheck") },
        { key: "timestamp", label: t("colChecked"), render: (c) => formatIndianDateTime(c.timestamp) },
        {
          key: "evidenceCount",
          label: t("colEvidence"),
          render: (c) =>
            typeof c.evidenceCount === "number"
              ? c.evidenceCount === 0
                ? t("evidenceNone")
                : t("evidenceCount", { count: c.evidenceCount })
              : t("noValue"),
        },
        // GAP-TENANT-ADMIN-COMPLIANCE-01: token-based, contrast-checked pill.
        { key: "result", label: t("colResult"), render: (c) => <StatusPill status={c.result} /> },
      ]}
      rows={checks as Row[]}
      sortable
      pageSize={10}
    />
  );
}
