import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Journey Builder", description: "Design and activate multi-step customer journeys.", href: "/journeys/builder" },
	{ title: "Active Journeys", description: "Monitor running journeys and enrollment status.", href: "/journeys/active" },
	{ title: "Templates", description: "Reusable journey templates for common scenarios.", href: "/journeys/templates" },
	{ title: "Analytics", description: "Journey performance, drop-off analysis, and conversions.", href: "/journeys/analytics" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Customer Journeys" subtitle="Multi-step campaign orchestration and automation." help="journeys" />
			<LinkTiles tiles={sections} columns="four" />
		</main>
	);
}
