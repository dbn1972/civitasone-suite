import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

// Municipal / non-tax revenue collection (revenue-service). Tiles are added as
// each revenue lane lands on main; links point only at live routes.
const revenueTiles: NavTile[] = [
	{ title: "Assessee Register", href: "/revenue/assessees", description: "Taxpayer register with demand-collection-balance." },
	{ title: "Assessments", href: "/revenue/assessments", description: "Create, revise and remit assessments (maker-checker)." },
	{ title: "Bills & Demands", href: "/revenue/bills", description: "Generate bills and view raised demands by assessee." },
	{ title: "Collection Receipts", href: "/revenue/receipts", description: "Record and review revenue collection receipts." },
	{ title: "Instalment Plans", href: "/revenue/instalments", description: "Assessee instalment plans for outstanding demands." },
	{ title: "Rate Configuration", href: "/revenue/config", description: "Rate heads, slabs, penalty and rebate rules." },
	{ title: "Refunds", href: "/revenue/refunds", description: "Raise and decide refunds against receipts (maker-checker)." },
	{ title: "Write-offs", href: "/revenue/write-offs", description: "Raise and decide demand write-offs (maker-checker)." },
	{ title: "Adjustments", href: "/revenue/adjustments", description: "Transfer or adjust amounts between demands." },
	{ title: "Recovery Referrals", href: "/revenue/recovery", description: "Refer defaulting demands for recovery action." },
	{ title: "Analytics", href: "/revenue/analytics", description: "Arrears ageing, defaulters, efficiency, trends and forecast." },
	{ title: "BBPS Bill Fetch & Pay", href: "/revenue/bbps", description: "Fetch and pay assessee bills via Bharat Bill Payment System." },
	{ title: "Trade Licenses", href: "/revenue/trade-licenses", description: "Issue, renew, and cancel municipal trade licenses." },
	{ title: "Collection Report", href: "/revenue/analytics", description: "Demand-collection-balance and defaulters report." },
	{ title: "Waivers", href: "/revenue/waivers", description: "Raise and decide penalty/interest waivers (maker-checker)." },
];

export default function RevenueHubPage() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Revenue" subtitle="Municipal revenue — assessees, demands, collection, and rate configuration." />
			<LinkTiles tiles={revenueTiles} />
		</main>
	);
}
