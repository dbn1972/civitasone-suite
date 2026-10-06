import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { getCitizenSurveys } from "../../../_data/loaders";
import { SurveysTable } from "./SurveysTable";

export default async function SurveysPage() {
  const t = await getTranslations("citizenSurveys");
  const { data: surveys, source } = await getCitizenSurveys();

  // GAP-CITIZEN-SURVEYS-02: the StatGrid used to be computed here from the raw
  // server prop while the table's rows came from useSeededResource (which can
  // substitute a cached copy on error/empty), so the cards and table could
  // disagree. Stats now live inside SurveysTable, computed from the SAME rows,
  // and read "—" on error with no cache (GAP-CITIZEN-SURVEYS-01).
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <SurveysTable surveys={surveys} source={source} />
    </>
  );
}
