import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type ApiElection = {
  id: string;
  plan_name: string;
  fy: string;
  elections: Array<{ component: string; electedMinor: number }>;
  total_elected_minor: number;
  status: string;
};

type Row = {
  id: string;
  plan_name: string;
  fy: string;
  total_elected: string;
  components: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapElections(rows: ApiElection[]): Row[] {
  return rows.map((e) => ({
    id: e.id,
    plan_name: e.plan_name ?? "—",
    fy: e.fy ?? "—",
    total_elected: formatINR(e.total_elected_minor),
    components: Array.isArray(e.elections)
      ? e.elections.map((c) => c.component).join(", ")
      : "—",
    status: e.status ?? "active",
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/benefits/my-elections", [], {
    telemetryKey: "hr.benefits",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiElection[] })?.data;
      return Array.isArray(arr) ? mapElections(arr as ApiElection[]) : null;
    },
  });
  return r;
}

export default async function BenefitsPage() {
  const t = await getTranslations("benefits");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const active = items.filter((i) => i.status === "active").length;
  const processing = items.filter((i) => ["processing", "pending", "submitted"].includes(i.status)).length;
  const closed = items.filter((i) => ["closed", "lapsed", "expired"].includes(i.status)).length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "plan_name", label: t("colPlan") },
    { key: "fy", label: t("colFinancialYear") },
    { key: "components", label: t("colComponents") },
    { key: "total_elected", label: t("colTotalElected") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="🏥" iconBg="#e6f0ff" label={t("statTotalEnrollmentsLabel")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statActiveLabel")} value={errored ? null : active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label={t("statProcessingLabel")} value={errored ? null : processing} />
        <StatCard icon="📁" iconBg="#f5f5f5" label={t("statClosedLabel")} value={errored ? null : closed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "benefits" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🏥"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </main>
  );
}
