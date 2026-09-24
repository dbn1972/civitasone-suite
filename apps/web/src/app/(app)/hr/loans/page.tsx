import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type ApiLoan = {
  id: string;
  employeeId: string;
  employeeName?: string;
  department?: string;
  loanType: string;
  sanctionedAmountMinor: number;
  emiMinor: number;
  outstandingMinor: number;
  totalEmis: number;
  emisPaid: number;
  status: string;
};

type Row = {
  id: string;
  employee: string;
  department: string;
  loanType: string;
  sanctionedAmount: number | null;
  emi: number | null;
  balance: number | null;
  status: string;
} & Record<string, unknown>;

function mapLoans(apiLoans: ApiLoan[]): Row[] {
  return apiLoans.map((l) => ({
    id: l.id,
    employee: l.employeeName ?? l.employeeId,
    department: l.department ?? "—",
    loanType: l.loanType,
    sanctionedAmount: l.sanctionedAmountMinor ?? null,
    emi: l.emiMinor != null ? l.emiMinor : null,
    balance: l.outstandingMinor != null ? l.outstandingMinor : null,
    status: l.status,
  }));
}

async function getLoans(): Promise<LoaderResult<Row[]>> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/loans", [], {
    telemetryKey: "hr.loans",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiLoan[] })?.data;
      return Array.isArray(arr) ? mapLoans(arr as ApiLoan[]) : null;
    },
  });
  return res;
}

export default async function LoansPage() {
  const t = await getTranslations("loans");
  const { data: items, source } = await getLoans();
  const errored = source === "error";

  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed" || i.status === "closed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "amount" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "loanType", label: t("colLoanType") },
    { key: "sanctionedAmount", label: t("colSanctioned"), cellType: "amount" },
    { key: "emi", label: t("colEmi"), cellType: "amount" },
    { key: "balance", label: t("colBalance"), cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={t("backToHr")} />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="💰" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLoansLabel")} value={errored ? null : items.length} />
        <StatCard icon="▶️" iconBg="var(--goodbg, #e6f7f0)" label={t("statActiveLabel")} value={errored ? null : active} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--bg, #f5f5f5)" label={t("statClosedLabel")} value={errored ? null : completed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "loans" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable exportable
          filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="💳"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </main>
  );
}
