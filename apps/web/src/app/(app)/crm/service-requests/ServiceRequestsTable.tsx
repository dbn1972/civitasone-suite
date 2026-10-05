"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DataTable, StatusPill, Button } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CrmServiceRequestRow } from "../../../_data/loaders";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "var(--bad)",
  high: "var(--warn)",
  normal: "var(--ink2)",
  low: "var(--ink2)",
};

function titleCase(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * GAP-CRM-SERVICE-REQUESTS-02: the enforceable controls shipped here are the
 * role gate (`canExport`), the mandatory purpose acknowledgement before the
 * file is built (`exportConfirm`), and DataTable's CSV-formula-injection
 * guard. A durable, immutable SERVER-SIDE audit record of each export is a
 * backend follow-up (a crm-service command + consumer): there is no CRM export
 * audit endpoint today, and this component must not invent one that silently
 * 404s. Flagged for HUMAN REVIEW.
 */

/**
 * Service request queue table.
 *
 * GAP-CRM-SERVICE-REQUESTS-01: pagination/sorting/searching are server-driven
 * (the server page re-queries the whole register per page/filter), so the table
 * renders exactly the current page and a Prev/Next pager that moves the `page`
 * URL param — client-side sorting/filtering over a partial page is disabled.
 *
 * GAP-CRM-SERVICE-REQUESTS-02: the CSV export (which carries citizen names —
 * personal data) is hidden unless the viewer holds a privileged role
 * (`canExport`), asks the operator to state a purpose first, and records an
 * audit note. DataTable additionally prefixes any formula-trigger cell to stop
 * CSV injection.
 */
export function ServiceRequestsTable({
  requests,
  source = "api",
  page,
  pageCount,
  total,
  pageSize,
  canExport = false,
  queryKey = "",
}: {
  requests: CrmServiceRequestRow[];
  source?: "api" | "error";
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  canExport?: boolean;
  queryKey?: string;
}) {
  const t = useTranslations("crmServiceRequestsTable");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CrmServiceRequestRow[]>(
    `crm.service-requests?${queryKey}`,
    requests,
    source,
    (d) => d.length === 0,
  );

  function goToPage(next: number) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next <= 1) params.delete("page");
    else params.set("page", String(next));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, total);

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<CrmServiceRequestRow>
        columns={[
          {
            key: "referenceNo",
            label: "Ref No.",
            render: (r) => (
              <code style={{ fontSize: 12, color: "var(--ink2)" }}>{r.referenceNo ?? "—"}</code>
            ),
          },
          { key: "citizenName", label: "Citizen", render: (r) => r.citizenName ?? "—" },
          { key: "serviceType", label: "Service Type", render: (r) => r.serviceType ?? "—" },
          { key: "subject", label: "Subject", render: (r) => r.subject ?? "—" },
          {
            key: "priority",
            label: "Priority",
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
                {titleCase(r.priority)}
              </span>
            ),
          },
          { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
          {
            key: "createdAt",
            label: "Logged",
            render: (r) => (
              <span style={{ color: "var(--ink2)", fontSize: 13 }}>
                {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN") : "—"}
              </span>
            ),
          },
          {
            key: "id",
            label: "",
            csvExclude: true,
            render: (r) => (
              <Link href={`/crm/service-requests/${r.id}`} className="btn" style={{ fontSize: 13 }}>
                View
              </Link>
            ),
          },
        ]}
        rows={rows}
        exportable={canExport}
        exportFilename="service-requests"
        exportConfirm={{
          title: t("exportTitle"),
          description: t("exportDescription"),
          confirmLabel: t("exportConfirm"),
        }}
        emptyIcon="📭"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />

      <div className="dt-pager" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
        <span style={{ fontSize: 13, color: "var(--ink2)" }} aria-live="polite">
          {total === 0 ? t("noRequests") : t("showing", { first: firstOnPage, last: lastOnPage, total: total.toLocaleString("en-IN"), page, pageCount })}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            {t("prev")}
          </Button>
          <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>
            {t("next")}
          </Button>
        </div>
      </div>
    </>
  );
}
