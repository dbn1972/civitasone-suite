import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState, LoadErrorState } from "../../../_components/ds";
import { maskLast4 } from "../../../_components/ds/Masked";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { BankAccountForm } from "./BankAccountForm";

type FY = { id: string; code: string; label: string; startDate: string; endDate: string; status: string } & Record<string, unknown>;
/**
 * GET /v1/finance/bank-accounts never returns the full number: it sends
 * `accountNoLast4` and a masked `ifscPrefix` (masters/bank-routes.ts). The
 * table used to read a non-existent `accountNo` key (GAP-FINANCE-CONFIG-02);
 * it now renders the server-masked value only.
 */
type Bank = { id: string; bankName: string; branchName: string | null; accountNoLast4: string; ifscPrefix: string; accountType: string; purpose: string | null; status: string } & Record<string, unknown>;
type BankRow = Bank & { accountMasked: string };

/** Bank-account create/list is finance_admin/super_admin only server-side (bank-routes.ts). */
const BANK_ADMIN_ROLES = ["finance_admin", "super_admin"];

async function getFYs(): Promise<LoaderResult<FY[]>> {
  return fetchJson<unknown, FY[]>("/api/v1/finance/fiscal-years", [], { telemetryKey: "config.fy", mapResponse: (p) => (p as { data: FY[] })?.data ?? null });
}
async function getBanks(): Promise<LoaderResult<Bank[]>> {
  return fetchJson<unknown, Bank[]>("/api/v1/finance/bank-accounts", [], { telemetryKey: "config.banks", mapResponse: (p) => (p as { data: Bank[] })?.data ?? null });
}

export default async function FinanceConfigPage() {
  const [fyResult, bankResult] = await Promise.all([getFYs(), getBanks()]);
  const fys = fyResult.data;
  const fyErr = fyResult.source === "error";
  const bankErr = bankResult.source === "error";
  const canManageBanks = getSessionRoles().some((r) => BANK_ADMIN_ROLES.includes(r));
  const activeFY = fys.find((f) => f.status === "active");
  const banks: BankRow[] = bankResult.data.map((b) => ({ ...b, accountMasked: maskLast4(String(b.accountNoLast4 ?? "")) }));

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Finance Configuration"
        subtitle="Set up your financial year, bank accounts, and opening balances before you start recording transactions."
        back="/finance"
        backLabel="Finance"
        help="finance"
      />

      <StatGrid>
        <StatCard icon="📅" iconBg="#e7edfd" label="Active FY" value={fyErr ? "—" : activeFY?.code ?? "Not set"} />
        <StatCard icon="🏦" iconBg="#ecfdf3" label="Bank Accounts" value={bankErr ? "—" : banks.length} />
      </StatGrid>

      {/* Financial Years -- created/activated on the Fiscal Years screen. */}
      <Card title="Financial Years">
        {fyResult.source === "error" ? (
          <div className="pad"><LoadErrorState result={fyResult} area="financial years" /></div>
        ) : fys.length === 0 ? (
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
        <div className="pad">
          <Link href="/finance/fiscal-years" className="btn ghost">Manage fiscal years</Link>
        </div>
      </Card>

      {/* Bank Accounts */}
      <Card title="Bank Accounts">
        {bankResult.source === "error" ? (
          <div className="pad"><LoadErrorState result={bankResult} area="bank accounts" requiredRoles={BANK_ADMIN_ROLES} /></div>
        ) : banks.length === 0 ? (
          <EmptyState icon="🏦" title="No bank accounts" message="Add your office's bank accounts so payments can be issued." />
        ) : (
          <DataTable<BankRow>
            columns={[
              { key: "bankName", label: "Bank" },
              { key: "branchName", label: "Branch" },
              { key: "accountMasked", label: "Account No" },
              { key: "ifscPrefix", label: "IFSC" },
              { key: "accountType", label: "Type" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={banks}
            sortable
          />
        )}
      </Card>
      {canManageBanks && !bankErr ? <BankAccountForm /> : null}

      {activeFY && (
        <Card title={`Opening Balances — ${activeFY.code}`}>
          <div className="pad" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <p style={{ color: "var(--mut)", fontSize: 13.5, margin: 0, flexBasis: "100%" }}>
              Enter the starting balances for each account head when migrating to CivitasOne.
            </p>
            <Link href={`/finance/opening-balances?fy=${encodeURIComponent(activeFY.code)}`} className="btn primary">Enter opening balances</Link>
            <Link href="/finance/chart-of-accounts" className="btn ghost">View account heads</Link>
          </div>
        </Card>
      )}
    </div>
  );
}
