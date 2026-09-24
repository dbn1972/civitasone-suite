import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { ComputeBonusForm } from "./ComputeBonusForm";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  employee_id: string;
  fy: string;
  basic_minor: number | string;
  bonus_pct: number | string;
  bonus_amount_minor: number | string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/bonus", [], {
    telemetryKey: "payroll.bonus",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function BonusPage() {
  const t = await getTranslations("payrollBonus");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "employee_id", label: t("colEmployee") },
    { key: "fy", label: t("colFy") },
    { key: "basic_minor", label: t("colBasic"), align: "right", cellType: "amount" },
    { key: "bonus_pct", label: t("colBonusPct"), align: "right" },
    { key: "bonus_amount_minor", label: t("colBonusAmount"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  const totalBonusMinor = items.reduce((sum, r) => sum + Number(r.bonus_amount_minor ?? 0), 0);
  const pendingBonus = items.filter((r) => r.status === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="🎁" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={errored ? null : items.filter((r) => r.status === "approved" || r.status === "paid").length} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statComputed")} value={errored ? null : formatMoney(totalBonusMinor)} />
        <StatCard icon="⏳" iconBg="var(--badbg)" label={t("statPending")} value={errored ? null : pendingBonus} />
      </StatGrid>

      <ComputeBonusForm />

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "bonus" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🎁"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}
