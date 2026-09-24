import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceGuarantees } from "@/app/_data/loaders";
import { GuaranteesTable } from "./GuaranteesTable";

export default async function GuaranteesPage() {
  const t = await getTranslations("expenditureGuarantees");
  const { data: guarantees, source } = await getFinanceGuarantees();
  const active = guarantees.filter((g) => String(g.status).toLowerCase() === "active").length;
  const released = guarantees.filter((g) => String(g.status).toLowerCase() === "released").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🛡️" iconBg="#e7edfd" label={t("statTotal")} value={guarantees.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label={t("statActive")} value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label={t("statReleased")} value={released} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label={t("statExpiringSoon")} value={guarantees.length - active - released} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside GuaranteesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title={t("cardTitle")}>
        <GuaranteesTable guarantees={guarantees} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
