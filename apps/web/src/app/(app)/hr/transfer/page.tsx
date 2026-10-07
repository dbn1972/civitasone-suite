import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getEmployeeById } from "@/app/_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { TransferWithApproval } from "./TransferWithApproval";
import type { TransferRow } from "./_components/TransferOrderCard";
import { TransferListFilters } from "./_components/TransferListFilters";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-TRANSFER-03: mirrors services/hrms-service's employee/routes.ts
 * HR_ROLES guard on POST /employees/:id/transfer/submit-approval exactly
 * (same three roles lifecycle/routes.ts uses for the direct issue-order/
 * relieve/join endpoints this page's cards call). hr/layout.tsx admits
 * every HR-adjacent role (including manager, employee, payroll_*) into the
 * whole /hr tree -- previously nothing on this page narrowed that further,
 * so "+ Transfer with approval" rendered fully interactive for a role that
 * would only ever get a 403 on submit, after filling in both wizard steps.
 */
const TRANSFER_ROLES = ["hr_admin", "hr_officer", "super_admin"];

async function getData(): Promise<LoaderResult<TransferRow[]>> {
  // NOTE: this used to fall back to GET /api/v1/hrms/transfers whenever the
  // lifecycle endpoint's array came back empty -- but that fallback path
  // does not exist as a backend route at all, so it always failed. Net
  // effect: a genuinely-empty (successful, zero-transfers) result from the
  // real endpoint was silently overwritten by a guaranteed error, turning a
  // true "no transfers" empty state into a false "couldn't load" one. Call
  // the one real endpoint directly.
  return fetchJson<unknown, TransferRow[]>("/api/v1/hrms/lifecycle/transfers", [], {
    telemetryKey: "hr.transfer",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: TransferRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function TransferPage({ searchParams }: { searchParams?: { empId?: string } }) {
  const t = await getTranslations("transfer");
  const roles = getSessionRoles();
  const canRaise = roles.some((r) => TRANSFER_ROLES.includes(r));

  const { data: raw, source, status, errorMessage } = await getData();
  const errored = source === "error";
  // GAP-HR-TRANSFER-01: the backend (lifecycle/routes.ts GET
  // /v1/hrms/lifecycle/transfers) already resolves employeeName and
  // fromDepartmentName/toDepartmentName (GAP-HR-SF-17, merged earlier) --
  // this mapping just never caught up to read them, so it fell through to
  // the raw id every time regardless. Prefer the real names; keep the old
  // fallback chain after them for a payload that predates that enrichment.
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  const items: TransferRow[] = raw.map((i) => ({
    ...i,
    employee: str(i.employeeName) ?? i.employee ?? i.employeeId ?? "Unknown",
    fromOffice: str(i.fromDepartmentName) ?? i.fromOffice ?? i.fromDeptId ?? "—",
    toOffice: str(i.toDepartmentName) ?? i.toOffice ?? i.toDeptId ?? "—",
  }));

  // Stat buckets use the shared real-status vocabulary (GAP-HR-TRANSFER-07):
  // "requested"/"pending_approval" haven't been actioned yet; "ordered" (the
  // direct path's issued order) and "pending_effective" (already approved
  // by eOffice, awaiting its effective date) are both past that gate.
  const completed = items.filter((i) => ["completed", "joined"].includes(i.status)).length;
  const pending   = items.filter((i) => ["requested", "pending_approval"].includes(i.status)).length;
  const approved  = items.filter((i) => ["ordered", "pending_effective"].includes(i.status)).length;
  const relieved  = items.filter((i) => i.status === "relieved").length;

  const tableColumns: { key: keyof TransferRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",     label: t("colEmployee")      },
    { key: "fromOffice",   label: t("colFrom")          },
    { key: "toOffice",     label: t("colTo")            },
    { key: "effectiveDate",label: t("colEffectiveDate")},
    { key: "orderNo",      label: t("colOrderNo")     },
    { key: "relievedDate", label: t("colRelievedDate") },
    { key: "status",       label: t("colStatus"), cellType: "status" },
  ];

  // GAP-HR-TRANSFER-09: resolve ?empId= (from employee detail's "Initiate
  // Transfer" quick action) to a real employee server-side, same pattern
  // retirement/page.tsx already uses for its own equivalent quick action --
  // this one previously read the param nowhere at all, so the wizard always
  // opened closed and blank regardless of where the link came from.
  const prefillEmployeeId = searchParams?.empId;
  const prefillResult = canRaise && prefillEmployeeId ? await getEmployeeById(prefillEmployeeId) : null;
  const prefillEmployee = prefillResult?.data ? { id: prefillEmployeeId as string, name: prefillResult.data.name } : null;

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={canRaise ? <TransferWithApproval prefillEmployee={prefillEmployee} /> : undefined}
      />
      <DataSourceBadge source={source} message="Couldn't load transfer orders — showing nothing" />

      <StatGrid>
<StatCard icon="🔄" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")}    value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statCompleted")} value={errored ? null : completed} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")}            value={errored ? null : pending} />
        <StatCard icon="👍" iconBg="var(--infobg, #f0f5ff)" label={t("statApproved")}       value={errored ? null : approved} />
        {relieved > 0 && (
          <StatCard icon="📍" iconBg="var(--warnbg, #fef9c3)" label={t("statRelieved")} value={errored ? null : relieved} />
        )}
      </StatGrid>

      {!canRaise && (
        <p role="note" style={{ fontSize: 13, color: "var(--mut,#64748b)", margin: "0 0 16px" }}>
          You have view-only access to transfer orders. Ask an HR admin to raise a new transfer.
        </p>
      )}

      {/* Card grid with filters + export — client island */}
      <TransferListFilters transfers={items} />

      {/* Table fallback for density view */}
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={{ status, errorMessage }} area="transfer" backHref="/hr" />
          </div>
        ) : (
          <DataTable<TransferRow>
          columns={tableColumns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📍"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
