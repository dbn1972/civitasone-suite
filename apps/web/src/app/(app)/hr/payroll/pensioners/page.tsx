import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { getPensioners } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import type { PensionerSummary } from "@civitasone/types";

type Row = PensionerSummary;
type DisplayRow = Row & { basicPensionDisplay: string };

export default async function PensionersPage() {
  const t = await getTranslations("pensioners");
  const { data: pensioners, source } = await getPensioners();

  const total = pensioners.length;
  const active = pensioners.filter((p) => p.status === "active").length;
  const pensionPayableMinor = pensioners
    .filter((p) => p.status === "active")
    .reduce((sum, p) => sum + p.basicPensionMinor, 0);
  const inactivePensioners = pensioners.filter((p) => p.status !== "active").length;

  // Server-safe: DataTable's `render` prop cannot cross the server/client
  // boundary (this is an async Server Component), so pre-format the display
  // amount into a plain string field instead.
  const rows: DisplayRow[] = pensioners.map((p) => ({ ...p, basicPensionDisplay: formatMoney(p.basicPensionMinor) }));

  const columns: { key: keyof DisplayRow & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "ppoNo", label: t("colPpoNo") },
    { key: "fullName", label: t("colName") },
    { key: "basicPensionDisplay", label: t("colBasicPension"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    { key: "ddoCode", label: t("colDdoCode") },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
        actions={
          <Link href="/hr/payroll/pensioners/new" className="btn primary">{t("addPensionerLink")}</Link>
        }
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="👴" iconBg="var(--panel)" label={t("statTotalPensioners")} value={total} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={active} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statPensionPayable")} value={formatMoney(pensionPayableMinor)} />
        <StatCard icon="🚫" iconBg="var(--badbg)" label={t("statInactive")} value={inactivePensioners} />
      </StatGrid>
      <Card title={t("recordsCardTitle")}>
        <DataTable<DisplayRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="👴"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </main>
  );
}
