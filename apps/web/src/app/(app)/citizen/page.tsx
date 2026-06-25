import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageShell } from "../../_components/PageShell";

const citizenTiles: NavTile[] = [
  { title: "Service Requests", href: "/citizen/requests" },
  { title: "RTI Applications", href: "/citizen/rti" },
];

export default function Page() {
  return (
    <PageShell title="Citizen Services" description="Grievances, service requests, and RTI applications.">
      <LinkTiles tiles={citizenTiles} />
    </PageShell>
  );
}
