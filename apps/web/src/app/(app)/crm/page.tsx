import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageShell } from "../../_components/PageShell";

const crmTiles: NavTile[] = [
	{ title: "Dashboard", href: "/crm/dashboard" },
	{ title: "Contacts", href: "/crm/contacts" },
	{ title: "Deal Pipeline", href: "/crm/deals" },
	{ title: "Activities", href: "/crm/activities" },
];

export default function Page() {
	return (
		<PageShell title="CRM" description="Pipeline and customer operations workspace.">
			<LinkTiles tiles={crmTiles} />
		</PageShell>
	);
}
