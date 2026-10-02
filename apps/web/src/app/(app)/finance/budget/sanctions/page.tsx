import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinanceSanctions } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { SanctionsTable } from "./SanctionsTable";

export default async function SanctionsPage() {
  const result = await getFinanceSanctions();
  const { data: sanctions, source } = result;
  // GAP-FINANCE-BUDGET-SANCTIONS-02: a failed fetch used to show
  // "Active 0 / Sanctioned ₹0.00 / Pending 0 / Approved 0" above a table that
  // might even show cached rows. Errored -> "—" cards and a load-error state
  // (PermissionDenied for 403, Retry otherwise) in place of the table.
  const errored = source === "error";

  const approved = sanctions.filter((s) => s.status === "approved").length;
  const pending = sanctions.filter((s) => s.status === "pending").length;
  // amount is a minor-unit (paise) decimal string — sum as BigInt so
  // formatMoney() gets the right scale and large totals can't drift.
  const totalAmount = sanctions.reduce((sum, s) => sum + BigInt(s.amount || "0"), 0n);

  return (
    <>
      <PageHeader
        title="Sanction Management"
        subtitle="Administrative &amp; financial sanctions with budget check."
        actions={
          // GAP-FINANCE-BUDGET-SANCTIONS-01: a real form, not a one-line confirm.
          <Link href="/finance/budget/sanctions/new" className="btn primary">+ New Sanction</Link>
        }
      />

      <StatGrid>
        <StatCard icon="🖊️" iconBg="#e7edfd" label="Active Sanctions" value={errored ? "—" : sanctions.length} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Sanctioned (FY)" value={errored ? "—" : formatMoney(totalAmount)} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={errored ? "—" : pending} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Approved" value={errored ? "—" : approved} delta={errored ? undefined : "approved"} up={true} />
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
