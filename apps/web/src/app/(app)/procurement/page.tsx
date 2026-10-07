import { getTranslations } from "next-intl/server";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
// GAP-PROCUREMENT-HOME-02/03: shared tiles module — the dashboard links to
// this same hub so the two module lists can never drift apart, and the tile
// labels come from the procurement.hub message tree (translatable).
import { buildProcurementTiles } from "./tiles";

export default async function Page() {
	const t = await getTranslations("procurement");
	const tHub = await getTranslations("procurement.hub");
	// GAP-PROCUREMENT-HOME-01: hide approval-sensitive tiles from users who
	// lack an approval role. super_admin sees everything (it is listed in the
	// approver role set). The service route stays the authority — direct URLs
	// still 403/redirect; this only removes dead-end navigation.
	const roles = getSessionRoles();
	const isSuperAdmin = roles.includes("super_admin");
	const tiles = buildProcurementTiles(tHub).filter(
		(tile) => !tile.roles || isSuperAdmin || tile.roles.some((r) => roles.includes(r)),
	);
	return (
		<div className="page-main">
			<PageHeader title={t("title")} subtitle={tHub("subtitle")} help="procurement" />
			<LinkTiles tiles={tiles} columns="four" />
		</div>
	);
}
