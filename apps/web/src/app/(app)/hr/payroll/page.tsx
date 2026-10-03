import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getPayrollRunDetails, getPayrollStructures } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatRupees } from "@/lib/formatters";
import { CreatePayrollRunForm } from "./CreatePayrollRunForm";
import { PayrollRunsTable } from "./PayrollRunsTable";
import { getActiveDdos, getActiveGroups } from "./pay-groups/payGroupData";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";

export default async function PayrollPage() {
  const t = await getTranslations("payroll");
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  // GAP-PAYROLL-HOME-02: GET /v1/payroll/runs 403s every role outside
  // PAYROLL_READER_ROLES (payroll-service routes.ts READER_ROLES) -- every
  // hr/layout.tsx role, including employee/manager, used to reach this far
  // and land on a generic RefreshErrorState from the failed fetch. Gate up
  // front so the real reason shows instead.
  const canView = roles.some((r) => PAYROLL_READER_ROLES.includes(r));
  if (!canView) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <PermissionDenied module="payroll runs" requiredRoles={PAYROLL_READER_ROLES} />
      </div>
    );
  }

  const [runsResult, structuresResult, payGroupsResult, ddosResult] = await Promise.all([
    getPayrollRunDetails(),
    getPayrollStructures(),
    canAdminister ? getActiveGroups() : Promise.resolve({ data: [], source: "api" as const }),
    canAdminister ? getActiveDdos() : Promise.resolve({ data: [], source: "api" as const }),
  ]);
  const { data: runs, source } = runsResult;
  const runsResource = toResourceState(runsResult);
  const errored = runsResource.status === "error";

  // GAP-PAYROLL-HOME-05: this used to destructure only `{ data: structures }`
  // from getPayrollStructures(), discarding whether the fetch itself had
  // failed. A structures outage then rendered the exact same "No pay
  // structures configured -- create one first" card (and hid the create
  // form) as a tenant that genuinely has none configured yet. Read the full
  // result and tell the two apart.
  const structuresResource = toResourceState(structuresResult);
  const structuresErrored = structuresResource.status === "error";
  const structures = structuresResult.data;

  // GAP-PAYROLL-HOME-03/04: the wire status enum is only ever draft/
  // processing/completed/paid/failed (payroll-service queries.ts
  // mapRunStatus remaps the internal approved/disbursed to completed/paid
  // before the API responds) -- there is no "approved" value to bucket on.
  // "completed" means approved and awaiting disbursement; money has not
  // moved yet, so it must not be counted as paid.
  //
  // The old "Employees Paid"/"Total Gross" tiles summed employeeCount/
  // grossAmount over EVERY paid-or-completed run ever: the same employees
  // counted again each month, and completed-but-unpaid runs folded into a
  // tile literally labelled "Paid". Use only the single most recent
  // ACTUALLY-paid run instead.
  const paidRuns = errored ? [] : runs.filter((r) => r.status === "paid");
  const latestPaidRun = paidRuns.length > 0
    ? paidRuns.reduce((a, b) => (b.payPeriod > a.payPeriod ? b : a))
    : null;

  const totalRuns = errored ? null : runs.length;
  const totalEmployeesPaid = errored ? null : (latestPaidRun?.employeeCount ?? 0);
  const totalGross = errored ? null : (latestPaidRun?.grossAmount ?? 0);
  // "Pending" now means every run not yet actually paid (draft, processing,
  // completed-awaiting-disbursement, or failed) -- it and the paid-run
  // count above always sum to totalRuns.
  const pending = errored ? null : runs.length - paidRuns.length;
  const existingPeriods = runs.map((r) => r.payPeriod);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        help="payroll"
      />
      {/* UX-002: the payroll-runs data-source badge now lives inside
          PayrollRunsTable, driven by the same useSeededResource call that
          produces the table's rows — not a second, independent read of
          `source` here that could disagree with the table's cache state. */}
      {canAdminister && !errored && (
        structuresErrored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "pay structures" })} />
          </div>
        ) : structures.length === 0 ? (
          <Card>
            <p style={{ color: "var(--ink2)", fontSize: 14, padding: "12px 20px" }}>
              {t("noStructuresMessage")}{" "}
              <Link href="/hr/payroll/structures" style={{ color: "var(--primary-d)", textDecoration: "underline" }}>
                {t("goToStructuresLink")}
              </Link>
            </p>
          </Card>
        ) : (
          <CreatePayrollRunForm structures={structures} existingPeriods={existingPeriods} payGroups={payGroupsResult.data} ddos={ddosResult.data} />
        )
      )}
      <StatGrid>
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalRuns")} value={totalRuns ?? "—"} />
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployeesPaid")} value={totalEmployeesPaid === null ? "—" : totalEmployeesPaid.toLocaleString("en-IN")} />
        <StatCard icon="🏛" iconBg="var(--warnbg)" label={t("statTotalGross")} value={totalGross === null ? "—" : formatRupees(totalGross)} />
        <StatCard icon="📄" iconBg="var(--panel)" label={t("statPending")} value={pending ?? "—"} />
      </StatGrid>
      <Card title={t("runsCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "payroll runs" })} backHref="/hr" />
          </div>
        ) : (
          <PayrollRunsTable runs={runs} source={source} canAdminister={canAdminister} />
        )}
      </Card>
    </div>
  );
}
