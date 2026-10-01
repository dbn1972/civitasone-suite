import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RequestAdvanceForm } from "./RequestAdvanceForm";
import { AdvancesTable } from "./AdvancesTable";
import { mapAdvances, type ApiAdvance, type Row } from "./mapAdvances";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";

import { getTranslations } from "next-intl/server";

// Matches ADVANCE_ROLES on the backend (services/hrms-service/src/modules/
// employee/loans-routes.ts) -- this page had no client-side gate at all, so
// any authenticated user could reach a form whose employee picker posts
// directly to POST /v1/hrms/salary-advances (now separately IDOR-guarded
// server-side). GAP-HR-ADVANCES-03 (decision packet, recommended default
// applied): "employee" added for self-service -- the backend forces their
// own employeeId server-side regardless of what the form sends.
const ADVANCE_ROLES = ["hr_admin", "finance_admin", "super_admin", "hr_officer", "manager", "officer", "employee"];

// GAP-HR-ADVANCES-02: only these roles may approve/reject -- mirrors the
// backend's own HR_ROLES for the approve/reject routes exactly (loans-routes.ts).
const ADVANCE_DECIDE_ROLES = ["hr_admin", "finance_admin", "super_admin", "hr_officer"];

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/salary-advances", [], {
    telemetryKey: "hr.advances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiAdvance[] })?.data;
      return Array.isArray(arr) ? mapAdvances(arr as ApiAdvance[]) : null;
    },
  });
  return r;
}

export default async function AdvancesPage() {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ADVANCE_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="salary advances" requiredRoles={ADVANCE_ROLES} />;
  }
  const canDecide = roles.some((r) => ADVANCE_DECIDE_ROLES.includes(r));
  // GAP-HR-ADVANCES-03: a session with ONLY "employee" (no HR/manager/officer
  // overlap) can only ever file for themselves -- the form hides the picker
  // entirely for this case rather than show one whose selection is ignored.
  const selfServiceOnly = roles.includes("employee")
    && !roles.some((r) => ["hr_admin", "finance_admin", "super_admin", "hr_officer", "manager", "officer"].includes(r));

  // GAP-HR-ADVANCES-05: mirrors employee/routes.ts's DIRECTORY_ROLES exactly
  // (READER_ROLES = HR_ROLES + manager, then + employee) -- the roles GET
  // /v1/hrms/employees actually admits. "officer" and "finance_admin" are in
  // ADVANCE_ROLES (can reach this page) but NOT in DIRECTORY_ROLES, so a
  // session holding only one of those two can neither self-file (not
  // selfServiceOnly -- that requires the "employee" role specifically) nor
  // pick a colleague (the picker's fetch would always 403). Computed here,
  // before ever attempting that doomed fetch, rather than letting
  // RequestAdvanceForm render an interactive-looking picker that can only
  // ever fail.
  const DIRECTORY_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager", "employee"];
  const canPickEmployees = roles.some((r) => DIRECTORY_ROLES.includes(r));
  const canRequestAdvance = selfServiceOnly || canPickEmployees;

  const t = await getTranslations("advances");
  const { data: items, source } = await getData();
  const errored = source === "error";

  // GAP-HR-ADVANCES-02: the API/DB status stays "active" on approve (see
  // mapAdvances.ts); this counts the same web-display field mapAdvances
  // already remapped to "approved", so the stat card and the table's
  // Status column always agree.
  const pending = items.filter((i) => i.rawStatus === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => i.rawStatus === "rejected").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      {/* GAP-HR-ADVANCES-08: the banner used to claim "showing nothing" even
          though RequestAdvanceForm below stays fully usable on a list-load
          failure (it doesn't depend on this GET) -- reworded to describe
          what actually failed. */}
      <DataSourceBadge source={source} message="Couldn't load the advances list — you can still submit a new request below" />
      <StatGrid>
<StatCard icon="💰" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="❌" iconBg="var(--badbg, #fdecea)" label={t("statRejected")} value={errored ? null : rejected} />
      </StatGrid>

      {canRequestAdvance ? (
        <RequestAdvanceForm selfServiceOnly={selfServiceOnly} />
      ) : (
        // GAP-HR-ADVANCES-05: role has ADVANCE_ROLES page access but no path
        // to file a request (no directory access to pick a colleague, and no
        // "employee" role to self-file) -- an explanatory note instead of a
        // form that can only ever 403, same pattern as transfer/page.tsx's
        // view-only note for roles outside TRANSFER_ROLES.
        <p role="note" style={{ fontSize: 13, color: "var(--mut,#64748b)", margin: "0 0 16px" }}>
          {t("viewOnlyNoDirectoryAccess")}
        </p>
      )}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "advances" })} backHref="/hr" />
          </div>
        ) : (
          <AdvancesTable
            rows={items}
            canDecide={canDecide}
            filterPlaceholder={t("filterPlaceholder")}
            emptyIcon="💰"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
            labels={{
              employee: t("colEmployee"),
              amount: t("colAmount"),
              purpose: t("colPurpose"),
              recovery: t("colRecovery"),
              recovered: t("colRecovered"),
              date: t("colDate"),
              status: t("colStatus"),
              actions: t("colActions"),
            }}
          />
        )}
      </Card>
    </div>
  );
}
