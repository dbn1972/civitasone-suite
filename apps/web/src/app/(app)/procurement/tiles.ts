import type { NavTile } from "@civitasone/types";
import { PROCUREMENT_APPROVER_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-PROCUREMENT-HOME-02/03/DASHBOARD-04: single source of truth for the
 * procurement module list. Previously the hub (procurement/page.tsx) and the
 * dashboard (procurement/dashboard/page.tsx) each hard-coded their own list,
 * so modules could silently drift and tile titles/descriptions were
 * untranslatable English literals. Both now derive from this one definition.
 *
 * `roles` (when present) gates the tile to approval-capable roles
 * (GAP-PROCUREMENT-HOME-01) — the service route remains the authority, this
 * only decides whether the tile is offered as navigation.
 */
interface TileDef {
	/** i18n key under procurement.hub.tiles.* */
	tileKey: string;
	href: string;
	/** Static English fallback title (used by non-localised consumers). */
	title: string;
	/** Static English fallback description. */
	description: string;
	roles?: string[];
}

export const procurementTileDefs: TileDef[] = [
	{ tileKey: "dashboard", href: "/procurement/dashboard", title: "Dashboard", description: "Snapshot of procurement activity" },
	{ tileKey: "planning", href: "/procurement/planning", title: "Annual Plans", description: "GFR annual procurement plan aggregation and approval" },
	{ tileKey: "indents", href: "/procurement/indents", title: "Purchase Indents", description: "Material requisitions from departments" },
	{ tileKey: "vendors", href: "/procurement/vendors", title: "Vendors", description: "Empanelled vendor directory" },
	{ tileKey: "rfq", href: "/procurement/rfq", title: "RFQ", description: "Request for quotation management" },
	{ tileKey: "orders", href: "/procurement/orders", title: "Purchase Orders", description: "Operational order book" },
	{ tileKey: "grn", href: "/procurement/grn", title: "Goods Receipt", description: "GRN tracking and quality checks" },
	{ tileKey: "contracts", href: "/procurement/contracts", title: "Contracts", description: "Rate and service contracts" },
	{ tileKey: "tenders", href: "/procurement/tenders", title: "Tenders", description: "Open and limited tenders" },
	// Approval-sensitive tiles: gated to approver roles (procurement_admin,
	// super_admin). A plain procurement_officer is 403'd by the approve/
	// evaluation/EMD/empanelment endpoints, so don't offer the tile.
	{ tileKey: "approvals", href: "/procurement/approvals", title: "Approvals", description: "Pending approvals and sign-offs", roles: PROCUREMENT_APPROVER_ROLES },
	{ tileKey: "bidEvaluation", href: "/procurement/bid-evaluation", title: "Bid Evaluation", description: "Technical and financial scoring matrix", roles: PROCUREMENT_APPROVER_ROLES },
	{ tileKey: "reverseAuction", href: "/procurement/reverse-auction", title: "Reverse Auction", description: "Live and scheduled reverse auctions" },
	{ tileKey: "gem", href: "/procurement/gem", title: "GeM", description: "Government e-Marketplace integration" },
	{ tileKey: "emdBg", href: "/procurement/emd-bg", title: "EMD & BG", description: "Earnest Money Deposit (EMD) and bank guarantee (BG) register", roles: PROCUREMENT_APPROVER_ROLES },
	{ tileKey: "empanelment", href: "/procurement/empanelment", title: "Empanelment", description: "Vendor empanelment management", roles: PROCUREMENT_APPROVER_ROLES },
	{ tileKey: "preBid", href: "/procurement/pre-bid", title: "Pre-Bid", description: "Pre-bid conference log" },
];

/**
 * Static (English) NavTile list. Retained for consumers that render tiles
 * outside a localised server component (the dashboard quick-link grid,
 * GAP-PROCUREMENT-DASHBOARD-04). Carries `roles` so callers can gate too.
 */
export const procurementTiles: NavTile[] = procurementTileDefs.map((def) => ({
	title: def.title,
	href: def.href,
	description: def.description,
	roles: def.roles,
}));

/**
 * Build the localised NavTile list from a next-intl translator scoped to the
 * `procurement.hub` namespace (GAP-PROCUREMENT-HOME-02). Preserves `roles`.
 */
export function buildProcurementTiles(t: (key: string) => string): NavTile[] {
	return procurementTileDefs.map((def) => ({
		title: t(`tiles.${def.tileKey}.title`),
		href: def.href,
		description: t(`tiles.${def.tileKey}.description`),
		roles: def.roles,
	}));
}
