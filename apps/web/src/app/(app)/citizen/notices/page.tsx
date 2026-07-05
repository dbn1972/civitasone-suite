import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getCitizenNotices } from "../../../_data/loaders";
import { NoticesTable } from "./NoticesTable";

export default async function NoticesPage() {
  const { data: notices, source } = await getCitizenNotices();

  const statutory = notices.filter((n) => n.type === "Statutory").length;
  const publicHearings = notices.filter((n) => n.type === "Public Hearing").length;
  const tenders = notices.filter((n) => n.type === "Tender").length;

  return (
    <>
      <PageHeader
        title="Public Notices"
        subtitle="Statutory and informational notices published by departments."
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard icon="📰" iconBg="#eef2ff" label="Total Notices" value={notices.length} />
        <StatCard icon="⚖️" iconBg="#ecfdf3" label="Statutory" value={statutory} />
        <StatCard icon="🏛️" iconBg="#fffaeb" label="Public Hearings" value={publicHearings} />
        <StatCard icon="📋" iconBg="#fce7ee" label="Tenders" value={tenders} />
      </StatGrid>

      <NoticesTable notices={notices} source={source} />
    </>
  );
}
