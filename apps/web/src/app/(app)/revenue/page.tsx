import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

// Municipal / non-tax revenue collection (revenue-service). Tiles are added as
// each revenue lane lands on main; links point only at live routes.
const revenueTiles: NavTile[] = [
	{ title: "Bills & Demands", href: "/revenue/bills", description: "Generate bills and view raised demands by assessee." },
	{ title: "Collection Receipts", href: "/revenue/receipts", description: "Record and review revenue collection receipts." },
	{ title: "Instalment Plans", href: "/revenue/instalments", description: "Assessee instalment plans for outstanding demands." },
];

export default function RevenueHubPage() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Revenue" subtitle="Municipal revenue — assessees, demands, collection, and rate configuration." />
			<LinkTiles tiles={revenueTiles} />
		</main>
	);
}
