import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { PeriodSelector } from "./PeriodSelector";
import { IngestChallanForm } from "./IngestChallanForm";

type ChallanRow = {
  cin: string;
  bsrCode: string;
  challanSerial: string;
  depositDate: string;
  section: string;
  tdsAmountMinor: string;
  totalAmountMinor: string;
  status: string;
} & Record<string, unknown>;

type ChallansResponse = { period: string; formType: string; count: number; challans: ChallanRow[] };

type ReconcilePeriod = {
  period: string;
  formType: string;
  tdsDeductedMinor: string;
  tdsDepositedMinor: string;
  varianceMinor: string;
  matched: boolean;
  challanCount: number;
  status: string;
};
type ReconcileResponse = {
  formType: string;
  period?: string;
  perPeriod: ReconcilePeriod[];
  totalDeductedMinor: string;
  totalDepositedMinor: string;
  varianceMinor: string;
  matched: boolean;
  filingBlocked: boolean;
  note: string;
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getChallans(period: string): Promise<LoaderResult<ChallanRow[]>> {
  return fetchJson<ChallansResponse, ChallanRow[]>(`/api/v1/payroll/statutory/challans?period=${encodeURIComponent(period)}`, [], {
    telemetryKey: "payroll.statutory.challans",
    mapResponse: (p) => (Array.isArray(p?.challans) ? p.challans : null),
  });
}

async function getReconciliation(period: string): Promise<LoaderResult<ReconcileResponse | null>> {
  return fetchJson<ReconcileResponse, ReconcileResponse | null>(`/api/v1/payroll/statutory/reconcile?period=${encodeURIComponent(period)}`, null, {
    telemetryKey: "payroll.statutory.reconcile",
    mapResponse: (p) => (p && Array.isArray(p.perPeriod) ? p : null),
  });
}

export default async function ChallansPage({ searchParams }: { searchParams?: { period?: string } }) {
  const period = searchParams?.period && /^\d{4}-\d{2}$/.test(searchParams.period) ? searchParams.period : currentPeriod();

  const [{ data: challans, source: challansSource }, { data: reconciliation, source: reconcileSource }] = await Promise.all([
    getChallans(period),
    getReconciliation(period),
  ]);

  const source = challansSource === "error" || reconcileSource === "error" ? "error" : "api";

  const columns: { key: keyof ChallanRow & string; label: string; align?: "left" | "right"; cellType?: "amount" | "status" }[] = [
    { key: "cin", label: "CIN" },
    { key: "bsrCode", label: "BSR Code" },
    { key: "challanSerial", label: "Serial" },
    { key: "depositDate", label: "Deposit Date" },
    { key: "section", label: "Section" },
    { key: "tdsAmountMinor", label: "TDS Amount", align: "right", cellType: "amount" },
    { key: "totalAmountMinor", label: "Total Amount", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="TDS Challans & Reconciliation"
        subtitle="Challan ingestion and deducted-vs-deposited TDS reconciliation, ahead of 24Q/26Q filing."
        back="/hr/payroll/statutory"
      />
      <DataSourceBadge source={source === "error" ? "error" : "api"} />

      <PeriodSelector period={period} />

      <StatGrid>
        <StatCard icon="🧾" iconBg="#e6f0ff" label="Challans for Period" value={challans.length} />
        <StatCard
          icon={reconciliation?.matched ? "✅" : "⚠️"}
          iconBg={reconciliation?.matched ? "#e6f7f0" : "#fdecea"}
          label="Reconciliation Status"
          value={reconciliation?.perPeriod[0]?.status ?? "unknown"}
        />
        <StatCard icon="📉" iconBg="#fffbe6" label="Variance" value={reconciliation ? formatMoney(reconciliation.varianceMinor) : "—"} />
      </StatGrid>

      <IngestChallanForm period={period} />

      <Card title={`Challans — ${period}`}>
        <DataTable<ChallanRow>
          columns={columns}
          rows={challans}
          sortable
          filterable
          filterPlaceholder="Filter by BSR code or CIN…"
          pageSize={15}
          emptyIcon="🧾"
          emptyTitle="No challans ingested for this period"
          emptyMessage="Ingest a TDS challan using the form above."
        />
      </Card>
    </main>
  );
}
