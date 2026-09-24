import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { PeriodSelector } from "./PeriodSelector";
import { IngestChallanForm } from "./IngestChallanForm";
import { toHumanError } from "@/lib/messages";

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
  const t = await getTranslations("challans");
  const period = searchParams?.period && /^\d{4}-\d{2}$/.test(searchParams.period) ? searchParams.period : currentPeriod();

  const [{ data: challans, source: challansSource }, { data: reconciliation, source: reconcileSource }] = await Promise.all([
    getChallans(period),
    getReconciliation(period),
  ]);

  const source = challansSource === "error" || reconcileSource === "error" ? "error" : "api";

  const errored = source === "error";

  const columns: { key: keyof ChallanRow & string; label: string; align?: "left" | "right"; cellType?: "amount" | "status" }[] = [
    { key: "cin", label: t("colCin") },
    { key: "bsrCode", label: t("colBsrCode") },
    { key: "challanSerial", label: t("colSerial") },
    { key: "depositDate", label: t("colDepositDate") },
    { key: "section", label: t("colSection") },
    { key: "tdsAmountMinor", label: t("colTdsAmount"), align: "right", cellType: "amount" },
    { key: "totalAmountMinor", label: t("colTotalAmount"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel="Back to Statutory"
      />
      <DataSourceBadge source={source === "error" ? "error" : "api"} message={t("loadErrorMessage")} />

      <PeriodSelector period={period} />

      <StatGrid>
        <StatCard icon="🧾" iconBg="var(--infobg)" label={t("statChallansForPeriod")} value={errored ? "—" : challans.length} />
        <StatCard
          icon={reconciliation?.matched ? "✅" : "⚠️"}
          iconBg={reconciliation?.matched ? "var(--goodbg, #e6f7f0)" : "var(--badbg, #fdecea)"}
          label={t("statReconciliationStatus")}
          value={errored ? "—" : (reconciliation?.perPeriod?.length ? reconciliation.perPeriod[0].status : t("unknownStatus"))}
        />
        <StatCard icon="📉" iconBg="var(--warnbg)" label={t("statVariance")} value={errored ? "—" : (reconciliation ? formatMoney(reconciliation.varianceMinor) : "—")} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTdsDeposited")} value={errored ? "—" : (reconciliation ? formatMoney(reconciliation.totalDepositedMinor) : "—")} />
      </StatGrid>

      <IngestChallanForm period={period} />

      <Card title={t("historyCardTitle", { period })}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "TDS challans" })} backHref="/hr/payroll/statutory" />
          </div>
        ) : (
          <DataTable<ChallanRow>
          columns={columns}
          rows={challans}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🧾"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
