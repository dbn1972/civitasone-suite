import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceSchemes } from "@/app/_data/loaders";
import { SchemeTable } from "./SchemeTable";

export default async function SchemeTrackingPage() {
  const t = await getTranslations("expenditureSchemeTracking");
  const { data: schemes, source } = await getFinanceSchemes();
  const active = schemes.filter((s) => String(s.status).toLowerCase() === "active").length;
  const completed = schemes.filter((s) => String(s.status).toLowerCase() === "completed").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label={t("statTotal")} value={schemes.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label={t("statActive")} value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label={t("statCompleted")} value={completed} />
        <StatCard icon="⏳" iconBg="#eff6ff" label={t("statPendingUc")} value={schemes.length - active - completed} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside SchemeTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title={t("cardTitle")}>
        <SchemeTable schemes={schemes} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
