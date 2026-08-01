import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Programs", description: "Create and manage loyalty programmes.", href: "/loyalty/programs" },
	{ title: "Members", description: "Member enrolments, balances, and tier status.", href: "/loyalty/members" },
	{ title: "Accruals", description: "Points earning transactions and bonus rules.", href: "/loyalty/accruals" },
	{ title: "Redemptions", description: "Point redemption history and reward fulfillment.", href: "/loyalty/redemptions" },
	{ title: "Tiers", description: "Tier definitions, thresholds, and benefits.", href: "/loyalty/tiers" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Loyalty Programs" subtitle="Points, tiers, and member rewards management." help="loyalty" />
			<LinkTiles tiles={sections} columns="four" />
		</main>
	);
}
