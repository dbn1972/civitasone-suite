import { PageHeader, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { getFinanceFiscalYears, getFinancePendingChangeRequests, getFinanceSettings } from "@/app/_data/loaders";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { ChangeRequestsPanel } from "../_components/ChangeRequestsPanel";
import { CHANGE_REQUEST_DECIDER_ROLES } from "../_components/changeRequests";
import { FiscalYearForm } from "./FiscalYearForm";
import { FiscalYearsTable } from "./FiscalYearsTable";
import { getPeriods } from "../period-close/periodsLoader";

export default async function FiscalYearsPage() {
  const [result, periodsResult, requestsResult, settingsResult] = await Promise.all([
    getFinanceFiscalYears(), getPeriods(), getFinancePendingChangeRequests("fiscal_year_activate"), getFinanceSettings(),
  ]);
  const canDecide = getSessionRoles().some((r) => CHANGE_REQUEST_DECIDER_ROLES.includes(r));
  const viewerId = getSessionUserId();
  // fp-finance-01: when the settings cannot be read, assume the conservative defaults (second approver on, new years as drafts).
  const secondApprover = settingsResult.data?.makerCheckerEnabled ?? true;
  const createsAsDraft = settingsResult.data?.fyCreateAsDraft ?? true;
  const pendingCodes = requestsResult.data.map((r) => r.subjectKey);
  const { data: fiscalYears, source } = result;
  const activeYear = fiscalYears.find((fy) => fy.status === "active");
  // GAP-FINANCE-FISCAL-YEARS-03: a failed load is not "no fiscal years". Show
  // the retry state instead of Total 0 / the create prompt, and do not offer
  // the create form -- the existing years are unknown, so a duplicate or
  // overlapping year could be created blind.
  const failed = source === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fiscal Years"
        subtitle="Define financial years and set the one currently open for posting."
        back="/finance"
      />

      {failed ? (
        <LoadErrorState result={result} area="fiscal years" backHref="/finance" />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📅" iconBg="#e6f0ff" label="Total Fiscal Years" value={fiscalYears.length} />
            <StatCard icon="🟢" iconBg="#e6f7f0" label="Active Fiscal Year" value={activeYear?.code ?? "—"} />
          </StatGrid>

          <FiscalYearForm rows={fiscalYears} createsAsDraft={createsAsDraft} />

          <FiscalYearsTable
            rows={fiscalYears}
            periods={periodsResult.data}
            periodsUnavailable={periodsResult.source === "error"}
            secondApprover={secondApprover}
            pendingCodes={pendingCodes}
          />

          {/* A failed load is its own state: never "nothing is waiting". */}
          {requestsResult.source === "error" ? (
            <LoadErrorState result={requestsResult} area="pending approvals" />
          ) : (
            <ChangeRequestsPanel requests={requestsResult.data} viewerId={viewerId} canDecide={canDecide} />
          )}
        </>
      )}
    </div>
  );
}
