import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { OpeningBalanceForm } from "./OpeningBalanceForm";

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

  const totalDebit = balances.reduce((sum, b) => sum + Number(b.debitMinor), 0);
  const totalCredit = balances.reduce((sum, b) => sum + Number(b.creditMinor), 0);

  const columns: { key: keyof OpeningBalanceRow; label: string; cellType?: "amount" }[] = [
    { key: "accountCode", label: "Account Code" },
    { key: "debitMinor", label: "Debit", cellType: "amount" },
    { key: "creditMinor", label: "Credit", cellType: "amount" },
    { key: "narration", label: "Narration" },
    { key: "enteredAtDisplay", label: "Entered On" },
  ];

  const overallSource = fySource === "error" || balancesSource === "error" ? "error" : "api";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Opening Balances"
        subtitle="View and set the starting debit/credit position for a fiscal year's accounts."
        back="/finance"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select fiscal year" padding>
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
                  {fy.label} ({fy.code}){fy.status === "active" ? " — active" : ""}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }}>View</button>
        </form>
      </Card>

      {!selectedFy ? (
        <Card title="Opening Balances">
          <EmptyState
            icon="🧾"
            title="Choose a fiscal year"
            message="Select a fiscal year above to view or set its opening balances."
          />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🧾" iconBg="#e6f0ff" label="Entries" value={balances.length} />
            <StatCard icon="⬇️" iconBg="#e6f7f0" label="Total Debit" value={formatMoney(totalDebit)} />
            <StatCard icon="⬆️" iconBg="#fff2e6" label="Total Credit" value={formatMoney(totalCredit)} />
          </StatGrid>

          <OpeningBalanceForm fyCode={selectedFy} />

          <Card title={`Opening Balances — ${selectedFy}`}>
            <DataTable<OpeningBalanceRow>
              columns={columns}
              rows={balances}
              sortable
              filterable
              filterPlaceholder="Filter by account code…"
              pageSize={15}
              emptyIcon="🧾"
              emptyTitle="No opening balances entered"
              emptyMessage="Enter opening balances for this fiscal year using the form above."
            />
          </Card>
        </>
      )}
    </main>
  );
}
