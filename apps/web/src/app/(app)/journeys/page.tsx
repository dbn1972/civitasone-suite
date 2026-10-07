import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader, StatGrid, StatCard } from "../../_components/ds";
import { getJourneyCounts } from "./_data";

export const dynamic = "force-dynamic";

// GAP-JOURNEYS-HOME-01: tile copy reworded to describe what the destination
// pages actually show today (a journey-definition list, trigger rules, and
// execution-outcome counts) rather than promising a canvas builder / full
// analytics suite that does not exist yet.
const sections: NavTile[] = [
	{ title: "Journey Definitions", description: "View journey definitions and their status.", href: "/journeys/builder" },
	{ title: "Active Journeys", description: "Monitor running journey executions and enrolment status.", href: "/journeys/active" },
	{ title: "Triggers", description: "Trigger rules that enroll profiles into journeys.", href: "/journeys/templates" },
	{ title: "Analytics", description: "Execution outcomes: completion and drop-off counts.", href: "/journeys/analytics" },
];

export default async function Page() {
	// GAP-JOURNEYS-HOME-02: surface how many journeys are defined and how many
	// executions are currently running. A failed fetch shows "—" (StatCard's
	// null convention), never a misleading 0.
	const counts = await getJourneyCounts();
	return (
		<div className="page-main">
			<PageHeader title="Customer Journeys" subtitle="Multi-step campaign orchestration and automation." help="journeys" />
			<StatGrid>
				<StatCard icon="🧭" tone="neutral" label="Journeys defined" value={counts.defined} />
				<StatCard icon="🏃" tone="info" label="Running executions" value={counts.running} />
			</StatGrid>
			<LinkTiles tiles={sections} columns="four" />
		</div>
	);
}
