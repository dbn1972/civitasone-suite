import { PageHeader, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { PayrollRunsTable } from "../PayrollRunsTable";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

export default async function PayrollRunsPage() {
  const t = await getTranslations("payrollRuns");
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  // GAP-PAYROLL-RUNS-04: no role gate existed at all -- every hr/layout.tsx
  // role (including employee/manager) reached run-level gross/net totals in
  // the rendered HTML, even though GET /v1/payroll/runs 403s anyone outside
  // payroll-service's READER_ROLES. Gate here instead of fetching and
  // failing generically.
  const canView = roles.some((r) => PAYROLL_READER_ROLES.includes(r));
  if (!canView) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel="Payroll" />
        <PermissionDenied module="payroll runs" requiredRoles={PAYROLL_READER_ROLES} />
      </div>
    );
  }

  // GAP-PAYROLL-RUNS-02: this used to be a bare, unbounded, unsorted,
  // unfilterable <table> duplicating what PayrollRunsTable (used on
  // /hr/payroll) already does with sort/filter/pageSize=12 and the
  // provenance badge. GAP-PAYROLL-RUNS-05: it also rendered <StatusPill
  // status=.../> with no translated label (unlike PayrollRunsTable).
  // GAP-PAYROLL-RUNS-03's "Create first run" CTA was shown to every role
  // regardless of whether they could use it -- all three are resolved by
  // reusing the same table component the working /hr/payroll page already
  // uses (its own empty-action hint is already gated on canAdminister),
  // rather than maintaining a second, drifting implementation.
  const result = await getPayrollRunDetails();
  const { data: runs, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
        backLabel="Payroll"
      />

      {errored ? (
        <div className="card" style={{ padding: 32 }}>
          <RefreshErrorState error={toHumanError("load", { area: "payroll runs" })} backHref="/hr/payroll" />
        </div>
      ) : (
        <div className="card">
          <PayrollRunsTable runs={runs} source={source} canAdminister={canAdminister} />
        </div>
      )}
    </div>
  );
}
