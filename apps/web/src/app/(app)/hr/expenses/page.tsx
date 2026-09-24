import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type ApiExpense = {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  receiptKey?: string;
  status: string;
  created_at: string;
};

type Row = {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapExpenses(rows: ApiExpense[]): Row[] {
  return rows.map((e) => ({
    id: e.id,
    category: e.category ?? "—",
    amount: e.amount ?? 0,
    description: e.description ?? "—",
    date: e.date ?? e.created_at ?? "—",
    status: e.status,
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/expenses", [], {
    telemetryKey: "hr.expenses",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiExpense[] })?.data;
      return Array.isArray(arr) ? mapExpenses(arr as ApiExpense[]) : null;
    },
  });
  return r;
}

export default async function ExpensesPage() {
  const t = await getTranslations("expenses");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; render?: (r: Row) => string }[] = [
    { key: "category", label: t("colCategory") },
    { key: "amount", label: t("colAmount"), render: (r) => formatINR(r.amount) },
    { key: "description", label: t("colDescription") },
    { key: "date", label: t("colClaimDate") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e6f0ff" label={t("statTotalClaimsLabel")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("statApprovedLabel")} value={errored ? null : approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="❌" iconBg="#fff0f0" label={t("statRejectedLabel")} value={errored ? null : rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "expenses" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🧾"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}
