import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader, StatCard, StatGrid } from "../../_components/ds";
import { getLoyaltyStats } from "./_data";
import { formatPoints } from "@/lib/formatters";

export const dynamic = "force-dynamic";

const sections: NavTile[] = [
	// GAP-LOYALTY-PROGRAMS-02: tile copy matches capabilities — the page is a
	// read-only programme list (no create/edit control is built), so it no
	// longer promises "Create and manage".
	{ title: "Programs", description: "View loyalty programmes.", href: "/loyalty/programs", icon: "🏆" },
	{ title: "Members", description: "Member enrolments, balances, and tier status.", href: "/loyalty/members", icon: "👤" },
	{ title: "Accruals", description: "Per-member points balances and lifetime points.", href: "/loyalty/accruals", icon: "➕" },
	{ title: "Redemptions", description: "Point redemption history and reward fulfilment.", href: "/loyalty/redemptions", icon: "🎁" },
	{ title: "Tiers", description: "Tier definitions, thresholds, and benefits.", href: "/loyalty/tiers", icon: "🏅" },
];

export default async function Page() {
	// GAP-LOYALTY-HOME-01: real KPIs from the list endpoints. A failed load
	// renders "—" (StatCard's own null handling), never a fabricated 0.
	const stats = await getLoyaltyStats();

	return (
		<div className="page-main">
			<PageHeader title="Loyalty Programs" subtitle="Points, tiers, and member rewards management." help="loyalty" />
			<StatGrid>
				<StatCard icon="👤" tone="info" label="Active members" value={stats.activeMembers} />
				<StatCard icon="✨" tone="good" label="Points issued (lifetime)" value={formatPointsOrDash(stats.pointsIssued)} />
				<StatCard icon="🎁" tone="warn" label="Redemptions pending" value={stats.redemptionsPending} />
			</StatGrid>
			<LinkTiles tiles={sections} columns="four" />
		</div>
	);
}

// Points issued is a points integer, not money/count — group it with en-IN,
// but keep StatCard's "—" when the figure is missing (load failed).
function formatPointsOrDash(points: string | null): string {
	return points === null ? "—" : formatPoints(points);
}
