import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getRTIApplications } from "../../../_data/loaders";
import { RTIClient } from "./RTIClient";
import { RegisterRTIButton } from "./RegisterRTIButton";

const TODAY = new Date().toISOString().slice(0, 10);

export default async function Page() {
  const t = await getTranslations("citizenRti");
  const { data: rtis, source } = await getRTIApplications();

  const pendingReply = rtis.filter((r) => r.status === "received" || r.status === "under_review" || r.status === "forwarded").length;
  const replied = rtis.filter((r) => r.status === "replied").length;
  const appeals = rtis.filter((r) => r.isFirstAppeal).length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        actions={<RegisterRTIButton />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📄" iconBg="#e0f5fa" label={t("statApplications")} value={rtis.length.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fffaeb" label={t("statDue")} value={pendingReply.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statReplied")} value={replied.toLocaleString("en-IN")} />
        <StatCard icon="⚖️" iconBg="#eff6ff" label={t("statAppeals")} value={appeals.toLocaleString("en-IN")} />
      </StatGrid>
      <RTIClient rtis={rtis} today={TODAY} />
    </>
  );
}
