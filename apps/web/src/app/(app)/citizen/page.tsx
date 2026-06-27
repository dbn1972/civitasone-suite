import type { NavTile } from "@civitasone/types";
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

export default function Page() {
  return (
    <PageShell title="Citizen Services" description="Grievances, service requests, and RTI applications." help="citizen">
      <LinkTiles tiles={citizenTiles} />
    </PageShell>
  );
}
