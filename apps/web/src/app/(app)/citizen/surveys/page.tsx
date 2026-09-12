import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenSurveys } from "../../../_data/loaders";
import { SurveysTable } from "./SurveysTable";

export default async function SurveysPage() {
  const t = await getTranslations("citizenSurveys");
  const { data: surveys, source } = await getCitizenSurveys();

  const active = surveys.filter((s) => s.status === "Active").length;
  const completed = surveys.filter((s) => s.status === "Completed").length;
  const totalResponses = surveys.reduce((sum, s) => sum + s.responses, 0);

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label={t("statActive")} value={active} />
        <StatCard icon="📝" iconBg="#ecfdf3" label={t("statTotalResponses")} value={totalResponses.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#fffaeb" label={t("statCompleted")} value={completed} />
        <StatCard icon="📅" iconBg="#fce7ee" label={t("statTotalSurveys")} value={surveys.length} />
      </StatGrid>

      <SurveysTable surveys={surveys} source={source} />
    </>
  );
}
