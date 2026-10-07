import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Tasks", description: "Field task assignments and completion tracking.", href: "/field/tasks" },
	{ title: "Visits", description: "Check-in/check-out logs with location verification.", href: "/field/visits" },
	{ title: "Routes", description: "Daily agent routes with optimised stop order.", href: "/field/routes" },
	{ title: "Agents", description: "Agents with assigned tasks and their task counts.", href: "/field/agents" },
	{ title: "Offline Sync", description: "Pending device sync changes pulled from the field.", href: "/field/sync" },
];

export default function Page() {
	return (
		<div className="page-main">
			<PageHeader title="Field Operations" subtitle="Task management, visit tracking, and route optimization." help="field" />
			<LinkTiles tiles={sections} columns="auto" />
		</div>
	);
}
