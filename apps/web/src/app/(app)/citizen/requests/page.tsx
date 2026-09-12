import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCitizenRequests } from "../../../_data/loaders";
import { CitizenRequestsClient } from "./CitizenRequestsClient";
import { LogRequestButton } from "./LogRequestButton";

export default async function Page() {
  const t = await getTranslations("citizenRequests");
  const { data: requests, source } = await getCitizenRequests();

  const open = requests.filter((r) => r.status === "submitted" || r.status === "under_review" || r.status === "in_progress").length;
  const resolved = requests.filter((r) => r.status === "resolved").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={<LogRequestButton />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📨" iconBg="#e0f5fa" label={t("statOpen")} value={open.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef3f2" label={t("statRejected")} value={rejected.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statResolved")} value={resolved.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#fffaeb" label={t("statTotal")} value={requests.length.toLocaleString("en-IN")} />
      </StatGrid>
      <CitizenRequestsClient requests={requests} />
    </>
  );
}
