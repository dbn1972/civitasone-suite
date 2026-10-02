import { Button, PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { getChartOfAccounts } from "@/app/_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { OPENING_BALANCE_WRITE_ROLES } from "@/lib/auth/workRoles";
import { OpeningBalanceForm } from "./OpeningBalanceForm";
import { accountLabel, fiscalYearOptionLabel, fyAllowsOpeningBalances, type CoaAccount } from "./openingBalanceAccounts";

type FiscalYearOption = { code: string; label: string; status: string };

export type OpeningBalanceRow = {
  id: string;
  accountCode: string;
  debitMinor: string | number;
  creditMinor: string | number;
  narration: string;
  enteredAtDisplay: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function arrayFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return null;
}

function mapFiscalYearOptions(payload: unknown): FiscalYearOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: FiscalYearOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const code = raw.code;
    const label = raw.label;
    const status = raw.status;
    if (typeof code !== "string" || typeof label !== "string") continue;
    mapped.push({ code, label, status: typeof status === "string" ? status : "unknown" });
  }
  return mapped;
}

function mapOpeningBalances(payload: unknown): OpeningBalanceRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: OpeningBalanceRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const accountCode = raw.accountCode;
    if (typeof id !== "string" || typeof accountCode !== "string") continue;
    mapped.push({
      id,
      accountCode,
      debitMinor: (raw.debitMinor as string | number | undefined) ?? 0,
      creditMinor: (raw.creditMinor as string | number | undefined) ?? 0,
      narration: typeof raw.narration === "string" ? raw.narration : "—",
      enteredAtDisplay: typeof raw.enteredAt === "string" ? formatIndianDate(raw.enteredAt) : "—",
    });
  }
  return mapped;
}

async function getFiscalYears(): Promise<LoaderResult<FiscalYearOption[]>> {
  return fetchJson<unknown, FiscalYearOption[]>("/api/v1/finance/fiscal-years", [], {
    telemetryKey: "finance.opening_balances.fiscal_years",
    mapResponse: mapFiscalYearOptions,
  });
}

async function getOpeningBalances(fyCode: string): Promise<LoaderResult<OpeningBalanceRow[]>> {
  return fetchJson<unknown, OpeningBalanceRow[]>(
    `/api/v1/finance/opening-balances/${encodeURIComponent(fyCode)}`,
    [],
    {
      telemetryKey: "finance.opening_balances",
      mapResponse: mapOpeningBalances,
    },
  );
}

export default async function OpeningBalancesPage({
  searchParams,
}: {
  searchParams?: { fy?: string };
}) {
  const selectedFy = searchParams?.fy?.trim() || "";

  const { data: fiscalYears, source: fySource } = await getFiscalYears();

  const balancesResult = selectedFy
    ? await getOpeningBalances(selectedFy)
    : ({ data: [] as OpeningBalanceRow[], source: "api" as const });
  const { data: balances, source: balancesSource } = balancesResult;

  // GAP-FINANCE-OPENING-BALANCES-03: the chart of accounts names the codes in the
  // table and validates / suggests them in the entry form. It is best-effort: a
  // failed read falls back to raw codes + a free-text form with a visible warning.
  const coaResult =
    selectedFy && balancesSource !== "error"
      ? await getChartOfAccounts()
      : null;
  const coaOk = !!coaResult && coaResult.source !== "error";
  const accounts: CoaAccount[] = coaOk
    ? coaResult.data.map((a) => ({ code: a.code, name: a.name, status: a.status }))
    : [];

  // GAP-FINANCE-OPENING-BALANCES-04: the API admits only finance_admin/super_admin to POST
  // (masters/fy-routes.ts WRITER_ROLES); everyone else sees the table read-only.
  const canEdit = getSessionRoles().some((r) => (OPENING_BALANCE_WRITE_ROLES as readonly string[]).includes(r));
  // GAP-FINANCE-OPENING-BALANCES-06: no entry form for a closed fiscal year.
  const selectedFyStatus = fiscalYears.find((fy) => fy.code === selectedFy)?.status;
  const fyOpen = fyAllowsOpeningBalances(selectedFyStatus);

  // Paise may exceed 2^53 in aggregate: sum as BigInt, never Number().
  const toMinor = (v: string | number) => {
    try { return BigInt(v); } catch { return 0n; }
  };
  const totalDebit = balances.reduce((sum, b) => sum + toMinor(b.debitMinor), 0n);
  const totalCredit = balances.reduce((sum, b) => sum + toMinor(b.creditMinor), 0n);

  const columns: { key: keyof OpeningBalanceRow; label: string; cellType?: "amount" }[] = [
    { key: "accountCode", label: "Account Code" },
    { key: "debitMinor", label: "Debit", cellType: "amount" },
    { key: "creditMinor", label: "Credit", cellType: "amount" },
    { key: "narration", label: "Narration" },
    { key: "enteredAtDisplay", label: "Entered On" },
  ];

  // GAP-FINANCE-OPENING-BALANCES-02: each fetch owns its error state. A
  // failed balances read used to render "No opening balances entered" next to
  // a live entry form, inviting a duplicate entry of balances that may
  // already exist; it now shows a Retry state and NO form (the safe
  // direction for ledger seeding) with "—" cards.
  const fyErr = fySource === "error";
  const balancesErr = !!selectedFy && balancesSource === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Opening Balances"
        subtitle="View and set the starting debit/credit position for a fiscal year's accounts."
        back="/finance"
      />

      <Card title="Select fiscal year" padding>
        {fyErr ? (
          <RefreshErrorState error={toHumanError("load", { area: "fiscal years" })} />
        ) : (
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="fy-select" style={{ fontSize: 13, fontWeight: 600 }}>Fiscal Year</label>
            <select
              id="fy-select"
              name="fy"
              defaultValue={selectedFy}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, minWidth: 220 }}
            >
              <option value="">Select a fiscal year…</option>
              {fiscalYears.map((fy) => (
                <option key={fy.code} value={fy.code}>
                  {fiscalYearOptionLabel(fy)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" style={{ minHeight: 44 }}>View</Button>
        </form>
        )}
      </Card>

      {!selectedFy ? (
        <Card title="Opening Balances">
          <EmptyState
            icon="🧾"
            title="Choose a fiscal year"
            message="Select a fiscal year above to view or set its opening balances."
          />
        </Card>
      ) : balancesErr ? (
        <>
          <StatGrid>
            <StatCard icon="🧾" iconBg="#e6f0ff" label="Entries" value="—" />
            <StatCard icon="⬇️" iconBg="#e6f7f0" label="Total Debit" value="—" />
            <StatCard icon="⬆️" iconBg="#fff2e6" label="Total Credit" value="—" />
          </StatGrid>
          <Card title={`Opening Balances — ${selectedFy}`}>
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "opening balances" })} backHref="/finance" />
            </div>
          </Card>
        </>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🧾" iconBg="#e6f0ff" label="Entries" value={balances.length} />
            <StatCard icon="⬇️" iconBg="#e6f7f0" label="Total Debit" value={formatMoney(totalDebit)} />
            <StatCard icon="⬆️" iconBg="#fff2e6" label="Total Credit" value={formatMoney(totalCredit)} />
          </StatGrid>

          {!fyOpen ? (
            <p role="alert" className="pill warn" style={{ width: "fit-content", margin: "0 0 16px" }}>
              Fiscal year {selectedFy} is {selectedFyStatus}. Opening balances cannot be set on a closed year, so the
              entry form is hidden; the saved balances below are read-only.
            </p>
          ) : canEdit ? (
            <OpeningBalanceForm
              fyCode={selectedFy}
              accounts={accounts}
              accountsUnavailable={!coaOk}
            />
          ) : (
            <p style={{ color: "var(--ink2)", fontSize: 13, margin: "0 0 16px" }}>
              Opening balances can be viewed here. Entering them is restricted to Finance Admins.
            </p>
          )}

          <Card title={`Opening Balances — ${selectedFy}`}>
            <DataTable<OpeningBalanceRow>
              columns={columns}
              rows={balances.map((b) => ({ ...b, accountCode: accountLabel(b.accountCode, accounts) }))}
              sortable
              filterable
              filterPlaceholder="Filter by account code or name…"
              pageSize={15}
              emptyIcon="🧾"
              emptyTitle="No opening balances entered"
              emptyMessage="Enter opening balances for this fiscal year using the form above."
            />
          </Card>
        </>
      )}
    </div>
  );
}
