import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles, hasAnyRole, FIELD_AGENT_ROSTER_ROLES } from "@/lib/auth/roleGuard";

export default async function Page() {
	// GAP-FIELD-HOME-04: hub copy comes from next-intl (en + hi), not literals.
	const t = await getTranslations("fieldHub");
	const sections: NavTile[] = [
		{ title: t("tasksTitle"), description: t("tasksDescription"), href: "/field/tasks" },
		{ title: t("visitsTitle"), description: t("visitsDescription"), href: "/field/visits" },
		{ title: t("routesTitle"), description: t("routesDescription"), href: "/field/routes" },
		{ title: t("agentsTitle"), description: t("agentsDescription"), href: "/field/agents" },
		{ title: t("syncTitle"), description: t("syncDescription"), href: "/field/sync" },
	];
	// The agent roster is tenant-wide and supervisor-only server-side (403 otherwise), so
	// the hub does not offer the tile to anyone else.
	const showRoster = hasAnyRole(getSessionRoles(), FIELD_AGENT_ROSTER_ROLES);
	const visible = sections.filter((s) => s.href !== "/field/agents" || showRoster);
	return (
		<div className="page-main">
			<PageHeader title={t("title")} subtitle={t("subtitle")} help="field" />
			<LinkTiles tiles={visible} columns="auto" />
		</div>
	);
}
