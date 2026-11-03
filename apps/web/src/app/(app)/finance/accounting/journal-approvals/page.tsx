import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../../_components/ds";
import { getChartOfAccounts } from "../../../../_data/loaders";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite, JOURNAL_APPROVE_ROLES } from "@/lib/finance/writeRoles";
import { buildHeadLookup } from "../../_components/headLookup";
import { JournalApprovals, mapPendingJournals, type PendingJournal } from "./JournalApprovals";

/** UAT P2 (J6, D4): manual journal vouchers waiting for a checker. */
export default async function JournalApprovalsPage() {
  const t = await getTranslations("journalApprovals");
  const [result, accounts] = await Promise.all([
    fetchJson<unknown, PendingJournal[]>("/api/v1/finance/journals/pending?limit=100", [], {
      telemetryKey: "finance.journals.pending",
      mapResponse: mapPendingJournals,
    }),
    getChartOfAccounts(),
  ]);
  const heads = buildHeadLookup(accounts.source === "error" ? [] : accounts.data);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/finance/accounting/general-ledger" />
      {result.source === "error" ? (
        <LoadErrorState result={result} area="pending journals" backHref="/finance/accounting/general-ledger" />
      ) : (
        <JournalApprovals initial={result.data} canApprove={canWrite(getSessionRoles(), JOURNAL_APPROVE_ROLES)} heads={heads} />
      )}
    </>
  );
}
