import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenNotices } from "../../../_data/loaders";
import { NoticesTable } from "./NoticesTable";

export default async function NoticesPage() {
  const t = await getTranslations("citizenNotices");
  const { data: notices, source } = await getCitizenNotices();

  const statutory = notices.filter((n) => n.type === "Statutory").length;
  const publicHearings = notices.filter((n) => n.type === "Public Hearing").length;
  const tenders = notices.filter((n) => n.type === "Tender").length;

  return (
    <>
      {/* UX-012: the data-source badge now lives inside NoticesTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
      />

      <StatGrid>
        <StatCard icon="📰" iconBg="#eef2ff" label={t("statTotal")} value={notices.length} />
        <StatCard icon="⚖️" iconBg="#ecfdf3" label={t("statStatutory")} value={statutory} />
        <StatCard icon="🏛️" iconBg="#fffaeb" label={t("statHearings")} value={publicHearings} />
        <StatCard icon="📋" iconBg="#fce7ee" label={t("statTenders")} value={tenders} />
      </StatGrid>

      <NoticesTable notices={notices} source={source} />
    </>
  );
}
