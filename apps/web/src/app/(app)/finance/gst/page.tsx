import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { currentMonthPeriod } from "@/lib/fiscalYear";
import { estimateCashPayable, gstHeadTotals, sumMinor, PERIOD_PATTERN } from "@/lib/finance/gstTotals";
import { PeriodSelector } from "./PeriodSelector";
import { GstConsole } from "./GstConsole";
import type { SummaryRow, LedgerRow, ItcRow } from "./types";

/** The endpoint default is 100 rows, which would silently truncate a busy month and its export. 500 is the maximum. */
const GST_LEDGER_LIMIT = 500;

type SummaryResponse = { period: string; summary: SummaryRow[] };
type ItcResponse = { period: string; reconciliation: ItcRow[] };

async function getSummary(period: string): Promise<LoaderResult<SummaryRow[]>> {
  return fetchJson<SummaryResponse, SummaryRow[]>(`/api/v1/finance/gst/summary?period=${encodeURIComponent(period)}`, [], {
    telemetryKey: "finance.gst.summary",
    mapResponse: (p) => (Array.isArray(p?.summary) ? p.summary : null),
  });
}

async function getLedger(period: string): Promise<LoaderResult<LedgerRow[]>> {
  return fetchJson<unknown, LedgerRow[]>(`/api/v1/finance/gst/ledger?period=${encodeURIComponent(period)}&limit=${GST_LEDGER_LIMIT}`, [], {
    telemetryKey: "finance.gst.ledger",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: LedgerRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getItcReconciliation(period: string): Promise<LoaderResult<ItcRow[]>> {
  return fetchJson<ItcResponse, ItcRow[]>(`/api/v1/finance/gst/itc-reconciliation?period=${encodeURIComponent(period)}`, [], {
    telemetryKey: "finance.gst.itcReconciliation",
    mapResponse: (p) => (Array.isArray(p?.reconciliation) ? p.reconciliation : null),
  });
}

export default async function GstConsolePage({ searchParams }: { searchParams?: { period?: string } }) {
  const requested = searchParams?.period;
  const periodValid = !!requested && PERIOD_PATTERN.test(requested);
  const period = periodValid ? requested : currentMonthPeriod();
  // GAP-FINANCE-GST-06: an unusable ?period= is called out, not silently swapped.
  const invalidRequested = requested !== undefined && requested !== "" && !periodValid ? requested : null;

  const [
    { data: summary, source: summarySource },
    { data: ledger, source: ledgerSource },
    { data: itc, source: itcSource },
  ] = await Promise.all([getSummary(period), getLedger(period), getItcReconciliation(period)]);

  // Per-source failure flags: a failed fetch falls back to [] and must NOT read
  // as a nil return (GAP-FINANCE-GST-01). `error` here means "failed", whereas
  // an api-ok empty list is a genuine empty period.
  const errors = { summary: summarySource === "error", ledger: ledgerSource === "error", itc: itcSource === "error" };
  const source = errors.summary || errors.ledger || errors.itc ? "error" : "api";
  const money = (v: bigint | null) => (v === null ? null : formatMoney(v));

  // GAP-FINANCE-GST-04: exact paise (bigint); an unparseable value renders "—", never 0.
  const outputTax = errors.summary ? null : sumMinor(summary.filter((r) => r.direction === "output").map((r) => r.total_tax));
  const summaryInputTax = errors.summary ? null : sumMinor(summary.filter((r) => r.direction === "input").map((r) => r.total_tax));
  const transactionCount = summary.reduce((s, r) => s + Number(r.transaction_count ?? 0), 0);
  // GAP-FINANCE-GST-02/03: ITC and payable come from the reconciliation (head-wise).
  const totals = errors.itc ? null : gstHeadTotals(itc);
  const itcMismatch =
    totals !== null && summaryInputTax !== null && totals.itcAvailable !== summaryInputTax;
  const estimate = errors.itc ? null : estimateCashPayable(itc);
  const payableLabel = totals === null ? null : totals.payable === 0n ? "Nil" : formatMoney(totals.payable);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="GST / ITC Console"
        subtitle="Output and input GST, the GST ledger, and input tax credit reconciliation for a filing period."
        back="/finance"
      />
      {source === "error" && (
        <>
          <DataSourceBadge source="error" />
          <div role="alert" className="banner" style={{ background: "#fef2f2", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
            Data incomplete — do not file. One or more GST sources failed to load, so the figures below may be missing.
          </div>
        </>
      )}

      {invalidRequested && (
        <div role="status" className="banner" style={{ background: "#fffbe6", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
          &quot;{invalidRequested}&quot; is not a valid period (use YYYY-MM, month 01 to 12). Showing {period} instead.
        </div>
      )}

      <PeriodSelector period={period} />

      <StatGrid>
        <StatCard icon="📤" iconBg="#fef3f2" label="Output Tax" value={money(outputTax)} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Input Tax Credit Available" value={money(totals?.itcAvailable ?? null)} />
        <StatCard
          icon={totals === null || totals.payable > 0n ? "⚠️" : "✅"}
          iconBg={totals === null || totals.payable > 0n ? "#fffbe6" : "#e6f7f0"}
          label="Net balance by tax head (before credit utilisation)"
          value={payableLabel}
        />
        <StatCard icon="↪️" iconBg="#eff6ff" label="Surplus credit by head" value={money(totals?.creditCarriedForward ?? null)} />
        <StatCard icon="🧮" iconBg="#eff6ff" label="Estimated cash payable after set-off" value={money(estimate?.cashPayable ?? null)} />
        <StatCard icon="🧾" iconBg="#eff6ff" label="Transactions" value={errors.summary ? null : transactionCount} />
      </StatGrid>
      {itcMismatch && totals !== null && summaryInputTax !== null && (
        <div role="alert" className="banner" style={{ background: "#fffbe6", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
          <strong>Mismatch:</strong> input tax on the summary ({formatMoney(summaryInputTax)}) differs from ITC available on
          the reconciliation ({formatMoney(totals.itcAvailable)}). Review the ITC Reconciliation tab before filing.
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 12px" }}>
        Balances are per tax head before the statutory credit set-off (IGST credit is applied against IGST, then CGST, then SGST; CGST and SGST credit against their own head, then IGST). Cash payable is finalised in GSTR-3B. Indicative only.
      </p>

      {ledgerSource !== "error" && ledger.length >= GST_LEDGER_LIMIT && (
        <div role="status" className="banner" style={{ background: "#fffbe6", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 }}>
          The ledger shows the first {GST_LEDGER_LIMIT} entries for this period; the list and its CSV export may be incomplete.
        </div>
      )}

      <Card title={`GST / ITC — ${period}`}>
        <GstConsole period={period} summary={summary} ledger={ledger} itc={itc} errors={errors} />
      </Card>
    </div>
  );
}
