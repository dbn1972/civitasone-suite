import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageShell } from "../../_components/PageShell";

const crmTiles: NavTile[] = [
	{ title: "Dashboard", href: "/crm/dashboard" },
	{ title: "Accounts", href: "/crm/accounts" },
	{ title: "Contacts", href: "/crm/contacts" },
	{ title: "Deals", href: "/crm/deals" },
	{ title: "Customer Onboarding", href: "/crm/onboarding" },
	{ title: "Pipeline Board", href: "/crm/pipeline" },
	{ title: "Sales Pipelines", href: "/crm/pipelines" },
	{ title: "Opportunities", href: "/crm/opportunities" },
	{ title: "Stage Ageing", href: "/crm/opportunity-ageing" },
	{ title: "Product Catalogue", href: "/crm/products" },
	{ title: "Price Books", href: "/crm/price-books" },
	{ title: "Quotations", href: "/crm/quotations" },
	{ title: "Revenue Forecast", href: "/crm/forecast" },
	{ title: "Account Health", href: "/crm/health" },
	{ title: "Activities", href: "/crm/activities" },
	{ title: "Voice of Customer", href: "/crm/voice-of-customer" },
	{ title: "Data Quality", href: "/crm/data-quality" },
	{ title: "Documents", href: "/crm/documents" },
	{ title: "Document Types", href: "/crm/document-types" },
	{ title: "Custom Fields", href: "/crm/custom-fields" },

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
