import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections: NavTile[] = [
	{ title: "Profiles", description: "Golden customer profiles with identity resolution.", href: "/cdp/profiles" },
	{ title: "Identity Graph", description: "Anonymous visitors pending identity resolution.", href: "/cdp/identity" },
	{ title: "Segments", description: "Create and manage audience segments for campaigns.", href: "/cdp/segments" },
	{ title: "Events", description: "Event taxonomy for interaction streams.", href: "/cdp/events" },
	{ title: "Data Steward", description: "Merge review and data quality governance.", href: "/cdp/steward" },
];

export default function Page() {
	return (
		<main className="page-main" aria-labelledby="page-heading">
			<PageHeader title="Customer Data Platform" subtitle="Unified customer profiles, identity resolution, and audience segments." help="cdp" />
			<LinkTiles tiles={sections} columns="four" />
		</main>
	);
}
