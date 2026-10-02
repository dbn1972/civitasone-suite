import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState, LoadErrorState } from "../../../_components/ds";
import { maskLast4 } from "../../../_components/ds/Masked";
import { getFinanceBankAccounts, getFinanceFiscalYears, type FinanceBankAccount, type FinanceFiscalYear } from "@/app/_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { BankAccountForm } from "./BankAccountForm";

// The table renders the server-masked account value only (GAP-FINANCE-CONFIG-02).
type FY = FinanceFiscalYear & Record<string, unknown>;
type BankRow = FinanceBankAccount & Record<string, unknown> & { accountMasked: string };

/** Bank-account create/list is finance_admin/super_admin only server-side (bank-routes.ts). */
const BANK_ADMIN_ROLES = ["finance_admin", "super_admin"];

export default async function FinanceConfigPage() {
  const [fyResult, bankResult] = await Promise.all([getFinanceFiscalYears(), getFinanceBankAccounts()]);
  const fys = fyResult.data as FY[];
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
              { key: "startDate", label: "Start", cellType: "date" },
              { key: "endDate", label: "End", cellType: "date" },
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

      {/* Setup order: financial year, bank accounts, opening balances. The card is
          always shown (GAP-FINANCE-CONFIG-06); without an active year the link is
          disabled with a hint instead of the card vanishing. */}
      <Card title={activeFY ? `Opening Balances — ${activeFY.code}` : "Opening Balances"}>
        <div className="pad" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <p style={{ color: "var(--mut)", fontSize: 13.5, margin: 0, flexBasis: "100%" }}>
            Enter the starting balances for each account head when migrating to CivitasOne.
          </p>
          {activeFY ? (
            <Link href={`/finance/opening-balances?fy=${encodeURIComponent(activeFY.code)}`} className="btn primary">Enter opening balances</Link>
          ) : (
            <>
              <button type="button" className="btn primary" disabled aria-describedby="opening-balances-hint">Enter opening balances</button>
              <p id="opening-balances-hint" style={{ color: "var(--mut)", fontSize: 13, margin: 0, flexBasis: "100%" }}>
                {fyErr ? "Financial years could not be loaded, so opening balances are unavailable right now." : "Activate a financial year first; opening balances are entered against the active year."}
              </p>
            </>
          )}
          <Link href="/finance/chart-of-accounts" className="btn ghost">View account heads</Link>
        </div>
      </Card>
    </div>
  );
}
