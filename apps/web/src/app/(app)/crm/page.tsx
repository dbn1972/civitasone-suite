import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageShell } from "../../_components/PageShell";

const crmTiles: NavTile[] = [
	{ title: "Dashboard", href: "/crm/dashboard" },
	{ title: "Accounts", href: "/crm/accounts" },
	{ title: "Contacts", href: "/crm/contacts" },
	{ title: "Deals", href: "/crm/deals" },
	{ title: "Pipeline Board", href: "/crm/pipeline" },
	{ title: "Revenue Forecast", href: "/crm/forecast" },
	{ title: "Account Health", href: "/crm/health" },
	{ title: "Activities", href: "/crm/activities" },
	{ title: "Voice of Customer", href: "/crm/voice-of-customer" },
	{ title: "Data Quality", href: "/crm/data-quality" },
	{ title: "Matching Rules", href: "/crm/dedup-rules" },
	{ title: "Lead Scoring", href: "/crm/lead-scoring" },
	{ title: "Qualification Frameworks", href: "/crm/qualification-frameworks" },
	{ title: "Lead Stage Reasons", href: "/crm/lead-reason-codes" },
	{ title: "Assignment Rules", href: "/crm/assignment-rules" },
	{ title: "Assignment Directory", href: "/crm/assignment-directory" },
	{ title: "Agent Workload", href: "/crm/agent-workload" },
	{ title: "Escalation Rules", href: "/crm/escalation-rules" },
	{ title: "Task Escalation", href: "/crm/task-escalation" },
	{ title: "Connected Accounts", href: "/crm/linked-accounts" },
];

export default function Page() {
	return (
		<PageShell title="CRM" description="Pipeline and customer operations workspace.">
			<LinkTiles tiles={crmTiles} />
		</PageShell>
	);
}
