"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CrmGrievanceRow } from "../../../_data/loaders";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "var(--bad)",
  high: "var(--warn)",
  normal: "var(--ink2)",
  low: "var(--ink2)",
};

const PRIORITY_KEYS = new Set(["urgent", "high", "normal", "low"]);

function titleCase(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * GAP-CRM-GRIEVANCES-04: a grievance's disposal-deadline cell. Compares the
 * server-provided ISO dueAt against now (both treated as absolute instants, so
 * no timezone skew), and flags anything past due that is NOT DISPOSED as
 * Overdue; a due date within 3 days gets a "due in N days" hint.
 */
function DueCell({ dueAt, status }: { dueAt: string | null; status: string }) {
  const t = useTranslations("crmGrievancesTable");
  if (!dueAt) return <span style={{ color: "var(--ink2)", fontSize: 13 }}>—</span>;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return <span style={{ color: "var(--ink2)", fontSize: 13 }}>—</span>;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.ceil((due.getTime() - now) / dayMs);
  const disposed = status === "DISPOSED";
  const overdue = !disposed && due.getTime() < now;
  const dateText = due.toLocaleDateString("en-IN");
  if (overdue) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <StatusPill status="overdue" />
        <span style={{ color: "var(--ink2)", fontSize: 12 }}>{dateText}</span>
      </span>
    );
  }
  const soon = !disposed && diffDays >= 0 && diffDays <= 3;
  return (
    <span style={{ fontSize: 13, color: soon ? "var(--warn)" : "var(--ink2)" }}>
      {dateText}
      {soon && (
        <span style={{ fontSize: 12, marginInlineStart: 6 }}>
          {t("dueIn", { days: diffDays })}
        </span>
      )}
    </span>
  );
}

/**
 * Grievance register table.
 *
 * Replaces a hand-rolled `<table>` so the register gains sorting, filtering,
 * pagination and CSV export — a grievance queue is worked by reference number
 * and by age, neither of which was reachable before.
 */
export function GrievancesTable({
  grievances,
  source = "api",
  page = 1,
  pageSize = 50,
  canExport = false,
}: {
  grievances: CrmGrievanceRow[];
  source?: "api" | "error";
  /** 1-based server page — part of the cache key so pages don't overwrite each other. */
  page?: number;
  /** API page size; the client pager is sized to match so it never sub-paginates a page. */
  pageSize?: number;
  /**
   * GAP-CRM-GRIEVANCES-05: whether to offer the CSV export. The register's CSV
   * includes citizen names (PII), so export is restricted to roles with a
   * need-to-know (DPDP data minimisation) and decided server-side.
   */
  canExport?: boolean;
}) {
  const t = useTranslations("crmGrievancesTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CrmGrievanceRow[]>(
    // GAP-CRM-GRIEVANCES-01: scope the offline cache per server page, otherwise
    // navigating to page 2 would overwrite page 1's cached rows under the same
    // key (and vice-versa), so an offline reader could never get back to page 1.
    `crm.grievances:p${page}`,
    grievances,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<CrmGrievanceRow>
        columns={[
          {
            key: "referenceNo",
            label: t("colRefNo"),
            render: (r) => (
              <code style={{ fontSize: 12, color: "var(--ink2)" }}>{r.referenceNo ?? "—"}</code>
            ),
          },
          { key: "citizenName", label: t("colCitizen"), render: (r) => r.citizenName ?? "—" },
          { key: "category", label: t("colCategory"), render: (r) => r.category ?? "—" },
          { key: "subject", label: t("colSubject"), render: (r) => r.subject ?? "—" },
          {
            key: "priority",
            label: t("colPriority"),
            render: (r) => (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--bg)",
                  background: PRIORITY_TONE[r.priority] ?? "var(--ink2)",
                }}
              >
                {PRIORITY_KEYS.has(r.priority) ? t(`priority.${r.priority}`) : titleCase(r.priority)}
              </span>
            ),
          },
          { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} /> },
          {
            key: "createdAt",
            label: t("colLogged"),
            render: (r) => (
              <span style={{ color: "var(--ink2)", fontSize: 13 }}>
                {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—"}
              </span>
            ),
          },
          {
            // GAP-CRM-GRIEVANCES-04: expose the disposal deadline so a clerk can
            // see which grievances are near or past due. Sorts on the raw ISO
            // dueAt (compareValues handles ISO strings); DISPOSED grievances are
            // never flagged overdue.
            key: "dueAt",
            label: t("colDue"),
            render: (r) => <DueCell dueAt={r.dueAt} status={r.status} />,
          },
          {
            key: "id",
            label: "",
            render: (r) => (
              <Link href={`/crm/grievances/${r.id}`} className="btn" style={{ fontSize: 13 }}>
                {t("view")}
              </Link>
            ),
          },
        ]}
        rows={rows}
        sortable
        pageSize={pageSize}
        exportable={canExport}
        exportFilename="grievances"
        emptyIcon="📭"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />
    </>
  );
}
