import { getTranslations } from "next-intl/server";
import { PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getCitizenRequests } from "../../../_data/loaders";
import { CitizenRequestsClient } from "./CitizenRequestsClient";
import { LogRequestButton } from "./LogRequestButton";
import { toHumanError } from "@/lib/messages";

export default async function Page() {
  const t = await getTranslations("citizenRequests");
  const { data: requests, source } = await getCitizenRequests();
  const errored = source === "error";

  const open = requests.filter((r) => r.status === "submitted" || r.status === "under_review" || r.status === "in_progress").length;
  const resolved = requests.filter((r) => r.status === "resolved").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        help="citizen"
        actions={<LogRequestButton />}
      />
      {/* GAP-CITIZEN-REQUESTS-01: a failed fetch must not read as "0 open, no
          service requests" under an amber badge. Show a real retry state and
          hide the fabricated zero stats + empty table entirely. */}
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "service requests" })} backHref="/citizen" />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📨" iconBg="#e0f5fa" label={t("statOpen")} value={open.toLocaleString("en-IN")} />
            <StatCard icon="🔴" iconBg="#fef3f2" label={t("statRejected")} value={rejected.toLocaleString("en-IN")} />
            <StatCard icon="✅" iconBg="#ecfdf3" label={t("statResolved")} value={resolved.toLocaleString("en-IN")} />
            <StatCard icon="📊" iconBg="#fffaeb" label={t("statTotal")} value={requests.length.toLocaleString("en-IN")} />
          </StatGrid>
          <CitizenRequestsClient requests={requests} />
        </>
      )}
    </>
  );
}
