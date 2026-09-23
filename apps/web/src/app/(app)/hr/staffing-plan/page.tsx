import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type Row = {
  id: string;
  department: string;
  cadre: string;
  sanctionedPosts: number;
  filled: number;
  vacant: number;
  fillPercentage: number;
  lastReview: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/staffing-plan", [], {
    telemetryKey: "hr.staffing-plan",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function StaffingPlanPage() {
  const t = await getTranslations("staffingPlan");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const totalSanctioned = items.reduce((s, i) => s + Number(i.sanctionedPosts ?? 0), 0);
  const totalFilled = items.reduce((s, i) => s + Number(i.filled ?? 0), 0);
  const totalVacant = items.reduce((s, i) => s + Number(i.vacant ?? 0), 0);
  const overallFill = totalSanctioned > 0 ? Math.round((totalFilled / totalSanctioned) * 100) : 0;

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "department", label: t("colDepartmentCadre") },
    { key: "sanctionedPosts", label: t("colSanctioned"), align: "right" },
    { key: "filled", label: t("colFilled"), align: "right" },
    { key: "vacant", label: t("colVacant"), align: "right" },
    { key: "fillPercentage", label: t("colFillPercent") },
    { key: "lastReview", label: t("colLastReview") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label={t("statSanctionedPostsLabel")} value={errored ? null : totalSanctioned} />
        <StatCard icon="👥" iconBg="#e6f7f0" label={t("statFilledLabel")} value={errored ? null : totalFilled} />
        <StatCard icon="⬜" iconBg="#fff1f0" label={t("statVacantLabel")} value={errored ? null : totalVacant} />
        <StatCard icon="📈" iconBg="#fffbe6" label={t("statFillRateLabel")} value={errored ? null : overallFill} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "staffing plan" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📊"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </main>
  );
}
