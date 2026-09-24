import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CreateReimbursementForm } from "./CreateReimbursementForm";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  employee_id: string;
  category: string;
  amount_minor: number | string;
  bill_date: string | null;
  bill_ref: string | null;
  period: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/reimbursements", [], {
    telemetryKey: "payroll.reimbursements",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ReimbursementsPage() {
  const t = await getTranslations("payrollReimbursements");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "employee_id", label: t("colEmployee") },
    { key: "category", label: t("colCategory") },
    { key: "amount_minor", label: t("colAmount"), align: "right", cellType: "amount" },
    { key: "period", label: t("colPeriod") },
    { key: "bill_ref", label: t("colBillRef") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  const totalMinor = items.reduce((sum, r) => sum + Number(r.amount_minor ?? 0), 0);
  const pendingCount = items.filter((r) => r.status === "submitted").length;
  const approvedReimb = items.filter((r) => r.status === "approved").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pendingCount} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statClaimed")} value={errored ? null : formatMoney(totalMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={errored ? null : approvedReimb} />
      </StatGrid>

      <CreateReimbursementForm />

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "reimbursements" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
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
    </main>
  );
}
