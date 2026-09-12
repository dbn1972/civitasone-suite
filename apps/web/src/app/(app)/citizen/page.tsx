import type { NavTile } from "@civitasone/types";
import { getTranslations } from "next-intl/server";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageShell } from "../../_components/PageShell";

const citizenTiles: NavTile[] = [
  { title: "Service Requests", href: "/citizen/requests" },
  { title: "RTI Applications", href: "/citizen/rti" },
  { title: "Grievances", href: "/citizen/grievances" },
  { title: "Feedback", href: "/citizen/feedback" },
  { title: "Portal Overview", href: "/citizen/portal" },
  { title: "Alerts & Notifications", href: "/citizen/alerts" },
  { title: "Public Notices", href: "/citizen/notices" },
  { title: "Surveys", href: "/citizen/surveys" },
];

export default async function Page() {
  const t = await getTranslations("citizen");
  return (
    <PageShell title={t("title")} description={t("description")} help="citizen">
      <LinkTiles tiles={citizenTiles} />
    </PageShell>
  );
}
