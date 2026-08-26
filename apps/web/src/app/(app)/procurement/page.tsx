import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const procurementTiles: NavTile[] = [
	{ title: "Dashboard", href: "/procurement/dashboard", description: "Snapshot of procurement activity" },
	{ title: "Annual Plans", href: "/procurement/planning", description: "GFR annual procurement plan aggregation and approval" },
	{ title: "Purchase Indents", href: "/procurement/indents", description: "Material requisitions from departments" },
	{ title: "Vendors", href: "/procurement/vendors", description: "Empanelled vendor directory" },
	{ title: "RFQ", href: "/procurement/rfq", description: "Request for quotation management" },
	{ title: "Purchase Orders", href: "/procurement/orders", description: "Operational order book" },
	{ title: "Goods Receipt", href: "/procurement/grn", description: "GRN tracking and quality checks" },
	{ title: "Contracts", href: "/procurement/contracts", description: "Rate and service contracts" },
	{ title: "Tenders", href: "/procurement/tenders", description: "Open and limited tenders" },
	{ title: "Approvals", href: "/procurement/approvals", description: "Pending approvals and sign-offs" },
	{ title: "Bid Evaluation", href: "/procurement/bid-evaluation", description: "Technical and financial scoring matrix" },
	{ title: "Reverse Auction", href: "/procurement/reverse-auction", description: "Live and scheduled reverse auctions" },
	{ title: "GeM", href: "/procurement/gem", description: "Government e-Marketplace integration" },
	{ title: "EMD & BG", href: "/procurement/emd-bg", description: "EMD and bank guarantee register" },
	{ title: "Empanelment", href: "/procurement/empanelment", description: "Vendor empanelment management" },
	{ title: "Pre-Bid", href: "/procurement/pre-bid", description: "Pre-bid conference log" },
];

export default async function Page() {
	const t = await getTranslations("procurement");
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title={t("title")} subtitle="Requisitions, vendors, purchase orders, and tenders with approval controls." help="procurement" />
			<LinkTiles tiles={procurementTiles} columns="four" />
		</main>
	);
}
