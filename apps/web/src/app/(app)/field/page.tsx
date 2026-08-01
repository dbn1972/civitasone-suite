import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Tasks", description: "Field task assignments and completion tracking.", href: "/field/tasks" },
	{ title: "Visits", description: "Check-in/check-out logs with location verification.", href: "/field/visits" },
	{ title: "Routes", description: "AI-optimized daily routes for field agents.", href: "/field/routes" },
	{ title: "Agents", description: "Field agent roster, territories, and performance.", href: "/field/agents" },
	{ title: "Offline Sync", description: "Device sync status and conflict resolution.", href: "/field/sync" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Field Operations" subtitle="Task management, visit tracking, and route optimization." help="field" />
			<LinkTiles tiles={sections} columns="four" />
		</main>
	);
}
