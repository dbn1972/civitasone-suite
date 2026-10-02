import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { currentMonthPeriod } from "@/lib/fiscalYear";
import { PeriodSelector } from "./PeriodSelector";
import { GstConsole } from "./GstConsole";
import type { SummaryRow, LedgerRow, ItcRow } from "./types";

type SummaryResponse = { period: string; summary: SummaryRow[] };
type ItcResponse = { period: string; reconciliation: ItcRow[] };

async function getSummary(period: string): Promise<LoaderResult<SummaryRow[]>> {
  return fetchJson<SummaryResponse, SummaryRow[]>(`/api/v1/finance/gst/summary?period=${encodeURIComponent(period)}`, [], {
    telemetryKey: "finance.gst.summary",
    mapResponse: (p) => (Array.isArray(p?.summary) ? p.summary : null),
  });
}

async function getLedger(period: string): Promise<LoaderResult<LedgerRow[]>> {
  return fetchJson<unknown, LedgerRow[]>(`/api/v1/finance/gst/ledger?period=${encodeURIComponent(period)}`, [], {
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
  const period = searchParams?.period && /^\d{4}-\d{2}$/.test(searchParams.period) ? searchParams.period : currentMonthPeriod();

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
  const money = (failed: boolean, v: number) => (failed ? null : formatMoney(v));

  const outputTax = summary
    .filter((r) => r.direction === "output")
    .reduce((s, r) => s + Number(r.total_tax ?? 0), 0);
  const inputTax = summary
    .filter((r) => r.direction === "input")
    .reduce((s, r) => s + Number(r.total_tax ?? 0), 0);
  const netPayable = itc.reduce((s, r) => s + Number(r.net_payable ?? 0), 0);
  const transactionCount = summary.reduce((s, r) => s + Number(r.transaction_count ?? 0), 0);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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

      <PeriodSelector period={period} />

      <StatGrid>
        <StatCard icon="📤" iconBg="#fef3f2" label="Output Tax" value={money(errors.summary, outputTax)} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="ITC Available (Input Tax)" value={money(errors.summary, inputTax)} />
        <StatCard
          icon={errors.itc ? "⚠️" : netPayable >= 0 ? "⚠️" : "✅"}
          iconBg={errors.itc || netPayable >= 0 ? "#fffbe6" : "#e6f7f0"}
          label="Net GST Payable"
          value={money(errors.itc, netPayable)}
        />
        <StatCard icon="🧾" iconBg="#eff6ff" label="Transactions" value={errors.summary ? null : transactionCount} />
      </StatGrid>

      <Card title={`GST / ITC — ${period}`}>
        <GstConsole period={period} summary={summary} ledger={ledger} itc={itc} errors={errors} />
      </Card>
    </div>
  );
}
