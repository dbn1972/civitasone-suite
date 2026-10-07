import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { getCitizenNotices } from "../../../_data/loaders";
import { NoticesTable } from "./NoticesTable";

export default async function NoticesPage() {
  const t = await getTranslations("citizenNotices");
  const { data: notices, source } = await getCitizenNotices();

  return (
    <>
      {/* GAP-CITIZEN-NOTICES-01: stats, the data-source badge and the table are
          ALL rendered by NoticesTable from one useSeededResource call, so a
          failed fetch can never show four zero stats under an error badge with
          a "No notices published" table. Only ACTIVE notices are counted
          (GAP-CITIZEN-NOTICES-02). */}
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <NoticesTable notices={notices} source={source} />
    </>
  );
}
