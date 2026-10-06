"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DataTable, StatusPill, Button } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { ServerExportButton } from "../../../_components/crm/ServerExportButton";
import { useSeededResource } from "@/lib/sync/resource";
import type { CrmServiceRequestRow } from "../../../_data/loaders";
import { PriorityBadge } from "./PriorityBadge";

/**
 * GAP-CRM-SERVICE-REQUESTS-03: a request is "overdue" when it has a due date in
 * the past AND it is still in a workable state (open/in_progress/pending). A
 * resolved/closed/cancelled request is never overdue, however old its due date.
 */
const WORKABLE = new Set(["open", "in_progress", "pending"]);
function isOverdue(dueAt: string | null, status: string): boolean {
  if (!dueAt || !WORKABLE.has(status)) return false;
  const due = new Date(dueAt).getTime();
  return Number.isFinite(due) && due < Date.now();
}

function fmtDate(dt: string | null): string {
  return dt ? new Date(dt).toLocaleDateString("en-IN") : "—";
}

/**
 * F2-02: the CSV export is now SERVER-AUDITED. The export button calls
 * crm-service's GET /v1/crm/service-requests/export, which applies the active
 * filters, masks citizen phone/email by role, enforces the admin gate and
 * records a bulk-export audit event with the operator's stated purpose. The
 * client-side DataTable Blob is disabled for this table — the server is the
 * authority and the only path that can be audited.
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
  const priorityText = (p: string): string | undefined => {
    const k = (p ?? "normal").toLowerCase();
    return k === "urgent" || k === "high" || k === "normal" || k === "low" ? t(`priority_${k}`) : undefined;
  };
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
      {canExport && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <ServerExportButton
            endpointPath="v1/crm/service-requests/export"
            filenameBase="service-requests"
            filters={{
              status: searchParams?.get("status") ?? undefined,
              priority: searchParams?.get("priority") ?? undefined,
              serviceType: searchParams?.get("serviceType") ?? undefined,
              assignedTo: searchParams?.get("assignedTo") ?? undefined,
              search: searchParams?.get("search") ?? searchParams?.get("q") ?? undefined,
            }}
            kind="serviceRequests"
          />
        </div>
      )}
      <DataTable<CrmServiceRequestRow>
        columns={[
          {
            key: "referenceNo",
            label: t("colRefNo"),
            render: (r) => (
              <code style={{ fontSize: 12, color: "var(--ink2)" }}>{r.referenceNo ?? "—"}</code>
            ),
          },
          { key: "citizenName", label: t("colCitizen"), render: (r) => r.citizenName ?? "—" },
          { key: "serviceType", label: t("colServiceType"), render: (r) => r.serviceType ?? "—" },
          { key: "subject", label: t("colSubject"), render: (r) => r.subject ?? "—" },
          {
            key: "priority",
            label: t("colPriority"),
            render: (r) => <PriorityBadge priority={r.priority} label={priorityText(r.priority)} />,
          },
          {
            key: "status",
            label: t("colStatus"),
            render: (r) =>
              isOverdue(r.dueAt, r.status) ? (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <StatusPill status={r.status} />
                  <StatusPill status="overdue" label={t("overdue")} variant="bad" />
                </span>
              ) : (
                <StatusPill status={r.status} />
              ),
          },
          {
            key: "assignedTo",
            label: t("colAssignedTo"),
            // We only hold the owner's opaque id here, not a display name (there
            // is no CRM assignee directory loader to resolve it, and showing a
            // raw uuid is worse than useless to a desk officer). Show whether the
            // request is owned at all; GAP-CRM-SERVICE-REQUESTS-03.
            render: (r) =>
              r.assignedTo ? (
                t("assigned")
              ) : (
                <span style={{ color: "var(--ink2)" }}>{t("unassigned")}</span>
              ),
          },
          {
            key: "dueAt",
            label: t("colDue"),
            render: (r) => (
              <span
                style={{
                  color: isOverdue(r.dueAt, r.status) ? "var(--bad)" : "var(--ink2)",
                  fontSize: 13,
                  fontWeight: isOverdue(r.dueAt, r.status) ? 600 : 400,
                }}
              >
                {fmtDate(r.dueAt)}
              </span>
            ),
          },
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
            key: "id",
            label: "",
            csvExclude: true,
            render: (r) => (
              <Link href={`/crm/service-requests/${r.id}`} className="btn" style={{ fontSize: 13 }}>
                {t("view")}
              </Link>
            ),
          },
        ]}
        rows={rows}
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
