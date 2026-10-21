import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { visibleHubSections } from "./hubTiles";

export default async function Page() {
	const t = await getTranslations("crm.hub");
	// GAP-CRM-HOME-01: every tile is filtered by the same role set its destination
	// layout enforces (see hubTiles.ts), so a plain crm_user is never shown a tile
	// that would just bounce them back to /crm. A section with no visible tile
	// is dropped; the Configuration section keeps the tiles every CRM role may open
	// (Data Quality, Connected Accounts).
	const visibleSections = visibleHubSections(getSessionRoles());
	return (
		<>
			<PageHeader title={t("title")} subtitle={t("subtitle")} />
			<div className="space-y-6">
				{visibleSections.map((section) => {
					const heading = t(`sections.${section.sectionKey}`);
					const tiles: NavTile[] = section.tiles.map((tile) => ({
						title: t(`tiles.${tile.tileKey}.title`),
						href: tile.href,
						description: t(`tiles.${tile.tileKey}.description`),
					}));
					return (
						<section
							key={section.sectionKey}
							aria-labelledby={"crm-section-" + section.sectionKey}
						>
							<h2
								id={"crm-section-" + section.sectionKey}
								className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3 px-1"
							>
								{heading}
							</h2>
							<LinkTiles tiles={tiles} />
						</section>
					);
				})}
			</div>
		</>
	);
}
