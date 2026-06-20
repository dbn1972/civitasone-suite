import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageShell } from "../../_components/PageShell";

const helpdeskTiles: NavTile[] = [
	{ title: "Citizen Tickets", href: "/helpdesk/tickets" },
	{ title: "Internal Ops", href: "/helpdesk/internal" },
	{ title: "Reports", href: "/helpdesk/reports" },
	{ title: "SLA Monitor", href: "/helpdesk/slas" },
];

export default function Page() {
	return (
		<PageShell title="Helpdesk" description="Ticket operations, SLA tracking, and support analytics.">
			<LinkTiles tiles={helpdeskTiles} />
		</PageShell>
	);
}
