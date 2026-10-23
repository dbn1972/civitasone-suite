import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles, hasAnyRole, FIELD_AGENT_ROSTER_ROLES } from "@/lib/auth/roleGuard";

const sections: NavTile[] = [
	{ title: "Tasks", description: "Field task assignments and completion tracking.", href: "/field/tasks" },
	{ title: "Visits", description: "Check-in/check-out logs with location verification.", href: "/field/visits" },
	{ title: "Routes", description: "Daily agent routes with optimised stop order.", href: "/field/routes" },
	{ title: "Agents", description: "Agents with assigned tasks and their task counts.", href: "/field/agents" },
	{ title: "Offline Sync", description: "Pending device sync changes pulled from the field.", href: "/field/sync" },
];

export default function Page() {
	// The agent roster is tenant-wide and supervisor-only server-side (403 otherwise), so
	// the hub does not offer the tile to anyone else.
	const showRoster = hasAnyRole(getSessionRoles(), FIELD_AGENT_ROSTER_ROLES);
	const visible = sections.filter((s) => s.href !== "/field/agents" || showRoster);
	return (
		<div className="page-main">
			<PageHeader title="Field Operations" subtitle="Task management, visit tracking, and route optimization." help="field" />
			<LinkTiles tiles={visible} columns="auto" />
		</div>
	);
}
