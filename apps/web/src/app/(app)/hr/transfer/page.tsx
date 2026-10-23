import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getEmployeeById } from "@/app/_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { TransferWithApproval } from "./TransferWithApproval";
import type { TransferRow } from "./_components/TransferOrderCard";
import { TransferListFilters } from "./_components/TransferListFilters";
import { getTranslations } from "next-intl/server";
import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";
import { countTransferBuckets } from "@/lib/hr/transferStatus";

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
const TRANSFER_ROLES = HR_STAFF_ROLES;

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

export default async function TransferPage(props: { searchParams?: Promise<{ empId?: string }> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("transfer");
  const tr = await getTranslations("transferUi");
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
    employee: str(i.employeeName) ?? i.employee ?? i.employeeId ?? tr("unknown"),
    fromOffice: str(i.fromDepartmentName) ?? i.fromOffice ?? i.fromDeptId ?? "—",
    toOffice: str(i.toDepartmentName) ?? i.toOffice ?? i.toDeptId ?? "—",
  }));

  // GAP-HR-TRANSFER-07/08: every status lands in exactly one stat bucket
  // (lib/hr/transferStatus.ts), so the cards below always add up to Total --
  // previously cancelled rows (an eOffice rejection) and any legacy "pending"
  // row were counted nowhere.
  const buckets = countTransferBuckets(items.map((i) => i.status));

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
        back="/hr" backLabel={t("backLabel")}
        actions={canRaise ? <TransferWithApproval prefillEmployee={prefillEmployee} /> : undefined}
      />
      <DataSourceBadge source={source} message={t("loadErrorBadge")} />

      <StatGrid>
        <StatCard icon="🔄" iconBg="var(--infobg)" label={t("statTotal")}    value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statCompleted")} value={errored ? null : buckets.completed} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")}   value={errored ? null : buckets.pending} />
        <StatCard icon="👍" iconBg="var(--infobg)" label={t("statApproved")}  value={errored ? null : buckets.approved} />
        {buckets.relieved > 0 && (
          <StatCard icon="📍" iconBg="var(--warnbg)" label={t("statRelieved")} value={errored ? null : buckets.relieved} />
        )}
        {buckets.cancelled > 0 && (
          <StatCard icon="✕" iconBg="var(--badbg)" label={t("statCancelled")} value={errored ? null : buckets.cancelled} />
        )}
      </StatGrid>

      {!canRaise && (
        <p role="note" style={{ fontSize: 13, color: "var(--mut)", margin: "0 0 16px" }}>
          {t("viewOnlyNote")}
        </p>
      )}

      {/* One filter bar + one filtered list, shown as cards or as a table
          (GAP-HR-TRANSFER-04) -- a client island. */}
      {errored ? (
        <Card title={t("cardTitle")}>
          <div className="pad">
            <LoadErrorState result={{ status, errorMessage }} area="transfer" backHref="/hr" />
          </div>
        </Card>
      ) : (
        <TransferListFilters transfers={items} />
      )}
    </div>
  );
}
