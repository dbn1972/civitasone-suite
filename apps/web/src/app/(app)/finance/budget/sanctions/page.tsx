import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinanceSanctions, getFinanceSanctionsSummary } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { SANCTION_CREATE_ROLES } from "@/lib/auth/workRoles";
import { SANCTION_STATUS_LABEL } from "../_lib/sanctionStats";
import { SanctionsTable } from "./SanctionsTable";

export default async function SanctionsPage() {
  const [result, summaryResult] = await Promise.all([
    getFinanceSanctions(),
    // GAP2-FINANCE-SANCTIONS-TOTALS-04: the approved-value money total and the
    // status counts come from a server-side aggregate over ALL sanctions, not
    // the (default-50-capped) register page.
    getFinanceSanctionsSummary(),
  ]);
  const { data: sanctions, source } = result;
  // GAP-FINANCE-BUDGET-SANCTIONS-02: a failed fetch used to show
  // "Active 0 / Sanctioned ₹0.00 / Pending 0 / Approved 0" above a table that
  // might even show cached rows. Errored -> "—" cards and a load-error state
  // (PermissionDenied for 403, Retry otherwise) in place of the table.
  const errored = source === "error";

  // GAP-FINANCE-BUDGET-SANCTIONS-03: "Sanctioned" is APPROVED money only (pending and
  // rejected sanctions used to inflate it); "Active" excludes rejected ones. No
  // fiscal-year filter exists on this list, so the cards are not labelled "(FY)".
  const summary = summaryResult.data;
  const summaryErrored = summaryResult.source === "error";
  // GAP-FINANCE-BUDGET-SANCTIONS-04: only the roles finance-service lets create a
  // sanction see the button (an audit/budget reader would hit a 403 after filling
  // the form). Deny by default: no/unknown roles never see the button (the backend
  // is the real boundary either way).
  const canCreate = getSessionRoles().some((r) => (SANCTION_CREATE_ROLES as readonly string[]).includes(r));

  return (
    <>
      <PageHeader
        title="Sanction Management"
        subtitle="Administrative &amp; financial sanctions with budget check."
        actions={
          // GAP-FINANCE-BUDGET-SANCTIONS-01: a real form, not a one-line confirm.
          canCreate ? <Link href="/finance/budget/sanctions/new" className="btn primary">+ New Sanction</Link> : undefined
        }
      />

      <StatGrid>
        <StatCard icon="🖊️" iconBg="#e7edfd" label="Active Sanctions" value={summaryErrored ? "—" : summary.active} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Sanctioned Value (approved)" value={summaryErrored ? "—" : formatMoney(summary.approvedMinor)} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={SANCTION_STATUS_LABEL.pending} value={summaryErrored ? "—" : summary.pending} />
        <StatCard icon="📊" iconBg="#ecfdf3" label={SANCTION_STATUS_LABEL.approved} value={summaryErrored ? "—" : summary.approved} />
      </StatGrid>

      <Card title="Administrative & financial sanctions">
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="sanctions" backHref="/finance" />
          </div>
        ) : (
          /* UX-012: the data-source badge lives inside SanctionsTable. */
          <SanctionsTable sanctions={sanctions} source="api" />
        )}
      </Card>
    </>
  );
}
