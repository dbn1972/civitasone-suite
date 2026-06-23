import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const procurementTiles: NavTile[] = [
	{ title: "Dashboard", href: "/procurement/dashboard", description: "Snapshot of procurement activity" },
	{ title: "Purchase Indents", href: "/procurement/indents", description: "Material requisitions from departments" },
	{ title: "Vendors", href: "/procurement/vendors", description: "Empanelled vendor directory" },
	{ title: "RFQ", href: "/procurement/rfq", description: "Request for quotation management" },
	{ title: "Purchase Orders", href: "/procurement/orders", description: "Operational order book" },
	{ title: "Goods Receipt", href: "/procurement/grn", description: "GRN tracking and quality checks" },
	{ title: "Contracts", href: "/procurement/contracts", description: "Rate and service contracts" },
	{ title: "Tenders", href: "/procurement/tenders", description: "Open and limited tenders" },
	{ title: "Approvals", href: "/procurement/approvals", description: "Pending approvals and sign-offs" },
];

export default function Page() {
	return (
		<>
			<PageHeader title="Procurement" subtitle="Requisitions, vendors, purchase orders, and tenders with approval controls." />
			<LinkTiles tiles={procurementTiles} columns="four" />
		</>
	);
}
