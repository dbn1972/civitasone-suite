import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

// Municipal / non-tax revenue collection (revenue-service). Tiles are added as
// each revenue lane lands on main; links point only at live routes.
// GAP-REVENUE-HOME-02: "Collection Report" was a duplicate entry point pointing
// at /revenue/analytics (same href as the Analytics tile) with no separate
// report route; it is removed and its intent folded into Analytics.
// GAP-REVENUE-HOME-03: every tile previously fell through to the same "📁"
// glyph and the list was flat; each tile now carries a distinct `icon` and a
// `section` so the hub renders labelled, grouped sections. No two tiles share
// an href.
const revenueTiles: NavTile[] = [
	// Register
	{ title: "Assessee Register", href: "/revenue/assessees", section: "Register", icon: "📇", description: "Taxpayer register with demand-collection-balance." },
	{ title: "Assessments", href: "/revenue/assessments", section: "Register", icon: "📐", description: "Create, revise and remit assessments (maker-checker)." },
	{ title: "Trade Licenses", href: "/revenue/trade-licenses", section: "Register", icon: "🪪", description: "Issue and track municipal trade licenses." },
	// Billing & Collection
	{ title: "Bills & Demands", href: "/revenue/bills", section: "Billing & Collection", icon: "🧾", description: "Generate bills and view raised demands by assessee." },
	{ title: "Collection Receipts", href: "/revenue/receipts", section: "Billing & Collection", icon: "💵", description: "Record and review revenue collection receipts." },
	{ title: "Instalment Plans", href: "/revenue/instalments", section: "Billing & Collection", icon: "📆", description: "Assessee instalment plans for outstanding demands." },
	{ title: "BBPS Bill Fetch & Pay", href: "/revenue/bbps", section: "Billing & Collection", icon: "🏦", description: "Fetch and pay assessee bills via Bharat Bill Payment System." },
	// Adjustments
	{ title: "Refunds", href: "/revenue/refunds", section: "Adjustments", icon: "↩️", description: "Raise and decide refunds against receipts (maker-checker)." },
	{ title: "Write-offs", href: "/revenue/write-offs", section: "Adjustments", icon: "🗑️", description: "Raise and decide demand write-offs (maker-checker)." },
	{ title: "Adjustments", href: "/revenue/adjustments", section: "Adjustments", icon: "🔀", description: "Transfer or adjust amounts between demands." },
	{ title: "Waivers", href: "/revenue/waivers", section: "Adjustments", icon: "🪙", description: "Raise and decide penalty/interest waivers (maker-checker)." },
	// Recovery & Config
	{ title: "Recovery Referrals", href: "/revenue/recovery", section: "Recovery & Config", icon: "⚖️", description: "Refer an assessee's outstanding arrears for coercive recovery." },
	{ title: "Rate Configuration", href: "/revenue/config", section: "Recovery & Config", icon: "⚙️", description: "Rate heads, slabs, penalty and rebate rules." },
	// Insight
	{ title: "Analytics", href: "/revenue/analytics", section: "Insight", icon: "📈", description: "Arrears ageing, defaulters, efficiency, trends, forecast and collection report." },
];

export default function RevenueHubPage() {
	return (
		<div className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Revenue" subtitle="Municipal revenue — assessees, demands, collection, and rate configuration." />
			<LinkTiles tiles={revenueTiles} />
		</div>
	);
}
