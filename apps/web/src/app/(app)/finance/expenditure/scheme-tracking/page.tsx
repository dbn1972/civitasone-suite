import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "@/app/_components/ds";
import { schemeStats } from "@/lib/finance/expenditureStats";
import { getFinanceSchemes } from "@/app/_data/loaders";
import { SchemeTable } from "./SchemeTable";

export default async function SchemeTrackingPage() {
  const t = await getTranslations("expenditureSchemeTracking");
  const result = await getFinanceSchemes();
  const { data: schemes, source } = result;
  const failed = result.source === "error" && schemes.length === 0;
  const stats = schemeStats(schemes);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label={t("statTotal")} value={failed ? null : stats.total} />
        <StatCard icon="📈" iconBg="#ecfdf3" label={t("statActive")} value={failed ? null : stats.active} />
        <StatCard icon="✅" iconBg="#fffaeb" label={t("statCompleted")} value={failed ? null : stats.completed} />
        <StatCard icon="⏳" iconBg="#eff6ff" label={t("statOtherStatus")} value={failed ? null : stats.otherStatus} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside SchemeTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      {failed ? (
        <LoadErrorState result={result} area={t("areaSchemes")} backHref="/finance" />
      ) : (
        <Card title={t("cardTitle")}>
          <SchemeTable schemes={schemes} source={source === "error" ? "error" : "api"} />
        </Card>
      )}
    </div>
  );
}
