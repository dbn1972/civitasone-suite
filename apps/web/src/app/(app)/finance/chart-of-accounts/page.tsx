import { PageHeader, Term, LoadErrorState } from "../../../_components/ds";
import { getChartOfAccounts, getFinancePendingChangeRequests } from "../../../_data/loaders";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { ChangeRequestsPanel } from "../_components/ChangeRequestsPanel";
import { CHANGE_REQUEST_DECIDER_ROLES } from "../_components/changeRequests";
import { AccountsTable } from "./AccountsTable";

export default async function ChartOfAccountsPage() {
  const [result, requestsResult] = await Promise.all([getChartOfAccounts(), getFinancePendingChangeRequests("hoa_change")]);
  const { data: accounts, source } = result;
  const canDecide = getSessionRoles().some((r) => CHANGE_REQUEST_DECIDER_ROLES.includes(r));
  const viewerId = getSessionUserId();

  return (
    <>
      <PageHeader
        title={<>Chart of Accounts <Term name="LMMHA" before="(" after=")" /></>}
        subtitle={<>Standard government head-of-account structure synced with <Term name="CGA" after="." /></>}
        help="finance"
        actions={
          <>
            {/* "Import LMMHA" used to point at the same href as "+ Add Head" —
                there is no bulk-import feature behind it (that page is a
                single-head manual create form), so the duplicate button is
                removed rather than left as a dead second link to the same
                form. */}
            <a href="/finance/chart-of-accounts/new" className="btn primary">+ Add Head</a>
          </>
        }
      />

      {/* UX-012: the data-source badge now lives inside AccountsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      {/* GAP-FINANCE-CHART-OF-ACCOUNTS-01: stat cards now live inside
          AccountsTable (same rows, same provenance). A 403 is a permission
          decision, so it gets the access-restricted state, not a retry. */}
      {source === "error" && result.status === 403 ? (
        <LoadErrorState result={result} area="chart of accounts" backHref="/finance" />
      ) : (
        <AccountsTable accounts={accounts} source={source} />
      )}

      {/* GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01: HoA-code changes wait here for a second
          finance administrator. A failed load is its own state, never "nothing waiting". */}
      {requestsResult.source === "error" ? (
        <LoadErrorState result={requestsResult} area="pending HoA changes" />
      ) : (
        <ChangeRequestsPanel requests={requestsResult.data} viewerId={viewerId} canDecide={canDecide} title="HoA code changes awaiting approval" />
      )}
    </>
  );
}
