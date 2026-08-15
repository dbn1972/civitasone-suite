import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { ExpenseClaimRow, type ExpenseClaim } from "./ExpenseClaimRow";
import { ExpenseClaimForm } from "./ExpenseClaimForm";

async function getExpenses() {
  return fetchJson<ExpenseClaim[], ExpenseClaim[]>("/api/v1/finance/expenses", [] as ExpenseClaim[], {
    revalidateSeconds: 30,
    telemetryKey: "finance.expenses",
    mapResponse: (d) => (Array.isArray(d) ? d : []),
  });
}

export default async function ExpensesPage() {
  const { data: claims, source } = await getExpenses();

  const pending = claims.filter((c) => c.status === "pending").length;
  const approved = claims.filter((c) => c.status === "approved").length;
  const awaitingDDO = claims.filter((c) => !c.ddoCountersigned && c.status !== "rejected").length;
  const totalAmount = claims.reduce((s, c) => s + (c.amount ?? 0), 0);
  const totalDisplay = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(totalAmount);

  return (
    <>
      <PageHeader
        title="Expense Claims"
        subtitle="Employee contingency and miscellaneous expenditure — GFR 2017 Rule 11. DDO countersignature required."
        actions={source === "error" ? <DataSourceBadge source={source} /> : undefined}
        help="finance-expenses"
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Claims" value={claims.length} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={approved} />
        <StatCard icon="🖊" iconBg="#fef3f2" label="Awaiting DDO" value={awaitingDDO} />
        <StatCard icon="💰" iconBg="#f0fdf4" label="Total Value" value={totalDisplay} />
      </StatGrid>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card title="Expense Claims Register">
            {claims.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No expense claims found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" aria-label="Expense claims">
                  <thead>
                    <tr>
                      <th scope="col" className="text-left py-2 px-3">Claim ID</th>
                      <th scope="col" className="text-left py-2 px-3">Employee</th>
                      <th scope="col" className="text-left py-2 px-3">Category</th>
                      <th scope="col" className="text-left py-2 px-3">Description</th>
                      <th scope="col" className="text-right py-2 px-3">Amount</th>
                      <th scope="col" className="text-center py-2 px-3">Receipt</th>
                      <th scope="col" className="text-center py-2 px-3">DDO Signed</th>
                      <th scope="col" className="text-left py-2 px-3">Date</th>
                      <th scope="col" className="text-left py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((claim) => (
                      <ExpenseClaimRow key={claim.id} claim={claim} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div>
          <Card title="New Claim" padding>
            <ExpenseClaimForm />
          </Card>
        </div>
      </div>
    </>
  );
}
