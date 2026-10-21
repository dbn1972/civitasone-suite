import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { getPayrollRunDetails, getPayrollStructures } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import { latestPaidRun, summariseRunStatuses } from "@/lib/payroll/runSummary";
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
      <div className="page-main wrap">
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
  // ACTUALLY-paid run instead, and say which period it is.
  //
  // The status tiles come from summariseRunStatuses: Paid + In progress +
  // Awaiting disbursement + Failed always sum to Total runs.
  const counts = errored ? null : summariseRunStatuses(runs);
  const latestPaid = errored ? null : latestPaidRun(runs);
  const latestPeriod = latestPaid?.payPeriod ?? null;
  // Money is rendered from the API's integer-paise string (GAP-PAYROLL-HOME-01);
  // a paid run whose payload lacks it shows "—" (unknown), never a made-up zero.
  const totalGrossDisplay = errored ? "—" : latestPaid ? formatMoney(latestPaid.grossMinor) : formatMoney(0n);
  const existingPeriods = runs.map((r) => r.payPeriod);

  return (
    <div className="page-main wrap">
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
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalRuns")} value={counts?.total ?? "—"} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statPaid")} value={counts?.paid ?? "—"} />
        <StatCard icon="📄" iconBg="var(--panel)" label={t("statInProgress")} value={counts?.inProgress ?? "—"} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statAwaitingDisbursement")} value={counts?.awaitingDisbursement ?? "—"} />
        <StatCard icon="⚠️" iconBg="var(--badbg)" label={t("statFailed")} value={counts?.failed ?? "—"} />
        <StatCard
          icon="👥"
          iconBg="var(--infobg)"
          label={latestPeriod ? t("statEmployeesPaidPeriod", { period: latestPeriod }) : t("statEmployeesPaid")}
          value={latestPaid ? latestPaid.employeeCount.toLocaleString("en-IN") : counts ? "0" : "—"}
        />
        <StatCard
          icon="🏛"
          iconBg="var(--warnbg)"
          label={latestPeriod ? t("statTotalGrossPeriod", { period: latestPeriod }) : t("statTotalGross")}
          value={totalGrossDisplay}
        />
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
