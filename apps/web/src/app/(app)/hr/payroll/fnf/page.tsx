import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ComputeFnfForm } from "./ComputeFnfForm";
import { FnFSettlementCards, type FnFCardRow } from "./FnFSettlementCard";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { FNF_READ_ROLES, FNF_COMPUTE_ROLES, fnfStatusBucket } from "./fnfWorkflow";
import { getTranslations } from "next-intl/server";

// GAP-PAYROLL-FNF-02: mirrors payroll-service's F&F read gate (fnf/routes.ts
// FNF_READ_ROLES). hr/layout.tsx admits employee/manager to all
// /hr/payroll* pages; they used to see every separated employee's
// settlement (and the compute form). Now they get PermissionDenied before
// any fetch. GAP-PAYROLL-FNF-01: payroll_officer may read (it submits) but
// not compute, so the compute form is shown only to FNF_COMPUTE_ROLES.

type SettlementRow = FnFCardRow & Record<string, unknown>;

async function getSettlements(): Promise<LoaderResult<SettlementRow[]>> {
  return fetchJson<unknown, SettlementRow[]>("/api/v1/payroll/fnf/settlements", [], {
    telemetryKey: "payroll.fnf.settlements",
    mapResponse: (p) => {
      const arr = (p as { data?: SettlementRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function FnfPage() {
  const t = await getTranslations("payrollFnf");
  const roles = getSessionRoles();
  if (!roles.some((r) => FNF_READ_ROLES.includes(r))) {
    return <PermissionDenied module="fnf" requiredRoles={FNF_READ_ROLES} />;
  }
  const canCompute = roles.some((r) => FNF_COMPUTE_ROLES.includes(r));
  const viewer = { userId: getSessionUserId(), roles };

  const { data: settlements, source } = await getSettlements();
  const errored = source === "error";

  // GAP-PAYROLL-FNF-04: stats come from the shared status->bucket map, so
  // pending + in-approval + settled always equals the total.
  const pending = settlements.filter((s) => fnfStatusBucket(s.status) === "pending").length;
  const inApproval = settlements.filter((s) => fnfStatusBucket(s.status) === "inApproval").length;
  const settled = settlements.filter((s) => fnfStatusBucket(s.status) === "settled").length;
  const separationTypes = new Set(settlements.map((s) => s.separationType).filter(Boolean)).size;

  // Pass the API's own fields straight through (money stays as paise
  // strings -- GAP-PAYROLL-FNF-06 -- never Number()-coerced).
  const cardRows: FnFCardRow[] = settlements.map((s) => ({
    id: s.id,
    employeeId: s.employeeId,
    employeeName: s.employeeName ?? null,
    employeeCode: s.employeeCode ?? null,
    separationType: s.separationType,
    separationDate: s.separationDate,
    status: s.status,
    netPayableMinor: s.netPayableMinor,
    noticeBuyoutMinor: s.noticeBuyoutMinor,
    leaveEncashmentGrossMinor: s.leaveEncashmentGrossMinor,
    gratuityGrossMinor: s.gratuityGrossMinor,
    retrenchmentCompMinor: s.retrenchmentCompMinor,
    vrsCompMinor: s.vrsCompMinor,
    arrearsMinor: s.arrearsMinor,
    tdsOnSeparationMinor: s.tdsOnSeparationMinor,
    gratuityExemptMinor: s.gratuityExemptMinor,
    leaveEncashExemptMinor: s.leaveEncashExemptMinor,
    version: typeof s.version === "number" ? s.version : null,
    computedBy: s.computedBy ?? null,
    submittedBy: s.submittedBy ?? null,
    financeApprovedBy: s.financeApprovedBy ?? null,
    rejectionReason: s.rejectionReason ?? null,
    paymentReference: s.paymentReference ?? null,
    paymentDate: s.paymentDate ?? null,
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="🧮" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : settlements.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="🔏" iconBg="var(--infobg)" label={t("statInApproval")} value={errored ? null : inApproval} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statSettled")} value={errored ? null : settled} />
        <StatCard icon="📊" iconBg="var(--panel)" label={t("statSeparationTypes")} value={errored ? null : separationTypes} />
      </StatGrid>

      {canCompute && <ComputeFnfForm />}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "fnf" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <div style={{ padding: "0 4px" }}>
            <FnFSettlementCards rows={cardRows} viewer={viewer} />
          </div>
        )}
      </Card>
    </div>
  );
}
