import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, DataTable, EmptyState, LoadErrorState } from "../../../_components/ds";
import { getFinanceBankAccounts, getFinanceFiscalYears, getFinanceSettings, getChartOfAccounts, getFinancePendingChangeRequests, type FinanceBankAccount, type FinanceFiscalYear } from "@/app/_data/loaders";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { ChangeRequestsPanel } from "../_components/ChangeRequestsPanel";
import { BankAccountForm } from "./BankAccountForm";
import { BankAccountsTable } from "./BankAccountsTable";
import { FinanceSettingsPanel } from "./FinanceSettingsPanel";

// The table renders the server-masked account value only; a finance admin can reveal it with a
// stated, audited reason (GAP-FINANCE-CONFIG-02).
type FY = FinanceFiscalYear & Record<string, unknown>;

/** Bank-account create/list is finance_admin/super_admin only server-side (bank-routes.ts). */
const BANK_ADMIN_ROLES = ["finance_admin", "super_admin"];

export default async function FinanceConfigPage() {
  const canManageBanks = getSessionRoles().some((r) => BANK_ADMIN_ROLES.includes(r));
  // The policy panel is for the admins who can change it; others never trigger the read.
  const [fyResult, bankResult, settingsResult, coaResult, relaxResult] = await Promise.all([
    getFinanceFiscalYears(), getFinanceBankAccounts(), canManageBanks ? getFinanceSettings() : Promise.resolve(null),
    canManageBanks ? getChartOfAccounts() : Promise.resolve(null),
    canManageBanks ? getFinancePendingChangeRequests("settings_relax") : Promise.resolve(null),
  ]);
  const viewerId = getSessionUserId();
  // GL head options for the debt posting selects; null when the chart could not be read (shown as an error, not empty).
  const headOptions = coaResult && coaResult.source !== "error"
    ? coaResult.data.filter((a): a is typeof a & { id: string } => typeof a.id === "string").map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
    : null;
  const fys = fyResult.data as FY[];
  const fyErr = fyResult.source === "error";
  const bankErr = bankResult.source === "error";
  const activeFY = fys.find((f) => f.status === "active");
  const banks: FinanceBankAccount[] = bankResult.data;

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
        ) : (
          <BankAccountsTable rows={banks} canReveal={canManageBanks} />
        )}
      </Card>
      {canManageBanks && !bankErr ? <BankAccountForm /> : null}

      {/* Second-approver and fiscal-year rules (finance admins only). A failed read is its own state. */}
      {canManageBanks && settingsResult ? (
        settingsResult.data ? (
          <>
            <FinanceSettingsPanel settings={settingsResult.data} heads={headOptions} />
            {relaxResult && relaxResult.source !== "error" ? (
              <ChangeRequestsPanel requests={relaxResult.data} viewerId={viewerId} canDecide={canManageBanks} title="Control changes awaiting a second admin" />
            ) : (
              <Card title="Control changes awaiting a second admin">
                <div className="pad"><LoadErrorState result={relaxResult ?? { status: 500 }} area="pending control changes" /></div>
              </Card>
            )}
          </>
        ) : (
          <Card title="Finance policy settings">
            <div className="pad"><LoadErrorState result={settingsResult} area="finance policy settings" requiredRoles={BANK_ADMIN_ROLES} /></div>
          </Card>
        )
      ) : null}

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
