import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getPayMatrix } from "../../../_data/loaders";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type Row = {
  id: string;
  level: string | number;
  payGrade: string;
  cell: string | number;
  basic: string;
} & Record<string, unknown>;

export default async function PayMatrixPage() {
  const t = await getTranslations("payMatrix");
  const { data: levels, source } = await getPayMatrix();
  const errored = source === "error";

  const rows: Row[] = levels.flatMap((l) =>
    l.cells.map((c) => ({
      id: `${l.level}-${c.cell}`,
      level: l.level,
      payGrade: l.payGrade,
      cell: c.cell,
      basic: c.basicDisplay,
    })),
  );

  const levelCount = levels.length;
  const cellCount = rows.length;
  const minPay = rows.at(0)?.basic ?? "—";
  const maxPay = rows.at(-1)?.basic ?? "—";

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right"; sortable?: boolean }[] = [
    { key: "level", label: t("colLevel"), align: "right" },
    { key: "payGrade", label: t("colPayGrade") },
    { key: "cell", label: t("colCell"), align: "right" },
    { key: "basic", label: t("colBasicPay"), align: "right", sortable: false },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backToHr")}
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label={t("statPayLevelsLabel")} value={errored ? null : levelCount} />
        <StatCard icon="🗂️" iconBg="#f5f5f5" label={t("statTotalCellsLabel")} value={errored ? null : cellCount} />
        <StatCard icon="💰" iconBg="#fffbe6" label={t("statMinBasicPayLabel")} value={errored ? null : minPay} />
        <StatCard icon="💎" iconBg="#e6f7f0" label={t("statMaxBasicPayLabel")} value={errored ? null : maxPay} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "pay matrix" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={20}
            emptyIcon="📊"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </main>
  );
}
