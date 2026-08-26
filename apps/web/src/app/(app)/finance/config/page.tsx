import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type FY = { id: string; code: string; label: string; startDate: string; endDate: string; status: string } & Record<string, unknown>;
type Bank = { id: string; bankName: string; branchName: string | null; accountNo: string; ifsc: string; accountType: string; purpose: string | null; status: string } & Record<string, unknown>;

async function getFYs(): Promise<LoaderResult<FY[]>> {
  return fetchJson<unknown, FY[]>("/api/v1/finance/fiscal-years", [], { telemetryKey: "config.fy", mapResponse: (p) => (p as { data: FY[] })?.data ?? null });
}
async function getBanks(): Promise<LoaderResult<Bank[]>> {
  return fetchJson<unknown, Bank[]>("/api/v1/finance/bank-accounts", [], { telemetryKey: "config.banks", mapResponse: (p) => (p as { data: Bank[] })?.data ?? null });
}

export default async function FinanceConfigPage() {
  const [{ data: fys, source: fySource }, { data: banks, source: bankSource }] = await Promise.all([getFYs(), getBanks()]);
  const source = fySource === "error" || bankSource === "error" ? "error" : "api";
  const activeFY = fys.find((f) => f.status === "active");

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Finance Configuration"
        subtitle="Set up your financial year, bank accounts, and opening balances before you start recording transactions."
        back="/finance"
        backLabel="Finance"
        help="finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="📅" iconBg="#e7edfd" label="Active FY" value={activeFY?.code ?? "Not set"} />
        <StatCard icon="🏦" iconBg="#ecfdf3" label="Bank Accounts" value={banks.length} />
      </StatGrid>

      {/* Financial Years */}
      <Card title="Financial Years">
        {fys.length === 0 ? (
          <EmptyState icon="📅" title="No financial year set" message="Create your first financial year to start recording transactions." />
        ) : (
          <DataTable<FY>
            columns={[
              { key: "code", label: "Code" },
              { key: "label", label: "Label" },
              { key: "startDate", label: "Start" },
              { key: "endDate", label: "End" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={fys}
            sortable
          />
        )}
      </Card>

      {/* Bank Accounts */}
      <Card title="Bank Accounts">
        {banks.length === 0 ? (
          <EmptyState icon="🏦" title="No bank accounts" message="Add your office's bank accounts so payments can be issued." />
        ) : (
          <DataTable<Bank>
            columns={[
              { key: "bankName", label: "Bank" },
              { key: "branchName", label: "Branch" },
              { key: "accountNo", label: "Account No" },
              { key: "ifsc", label: "IFSC" },
              { key: "accountType", label: "Type" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={banks}
            sortable
          />
        )}
      </Card>

      {activeFY && (
        <Card title={`Opening Balances — ${activeFY.code}`}>
          <div className="pad">
            <p style={{ color: "var(--mut)", fontSize: 13.5 }}>
              Enter the starting balances for each account head when migrating to CivitasOne.
              Use the API: <code>POST /v1/finance/opening-balances</code> with account codes and amounts.
            </p>
            <Link href={`/finance/chart-of-accounts`} className="btn ghost">View account heads</Link>
          </div>
        </Card>
      )}

      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
        Create financial years and bank accounts via the setup wizard or the API.
        A full UI form is coming soon — for now, use <code>POST /v1/finance/fiscal-years</code> and <code>POST /v1/finance/bank-accounts</code>.
      </p>
    </main>
  );
}
