import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";

const sections = [
	{
		heading: "Core",
		tiles: [
			{ title: "Dashboard", href: "/crm/dashboard", description: "Overview metrics and activity" },
			{ title: "Contacts", href: "/crm/contacts", description: "Vendor, beneficiary, and stakeholder contacts" },
			{ title: "Accounts", href: "/crm/accounts", description: "Organisations and institutions" },
			{ title: "Deals", href: "/crm/deals", description: "Engagements and procurement opportunities" },
			{ title: "Activities", href: "/crm/activities", description: "Calls, meetings, and follow-ups" },
		] as NavTile[],
	},
	{
		heading: "Sales & Pipeline",
		tiles: [
			{ title: "Pipeline Board", href: "/crm/pipeline", description: "Visual kanban of deal stages" },
			{ title: "Sales Pipelines", href: "/crm/pipelines", description: "Configure pipeline stages" },
			{ title: "Opportunities", href: "/crm/opportunities", description: "Track opportunity funnel" },
			{ title: "Stage Ageing", href: "/crm/opportunity-ageing", description: "Stale opportunity alerts" },
			{ title: "Revenue Forecast", href: "/crm/forecast", description: "Pipeline revenue projections" },
			{ title: "Quotations", href: "/crm/quotations", description: "Quotes and proposals" },
			{ title: "Customer Onboarding", href: "/crm/onboarding", description: "Post-deal onboarding workflows" },
		] as NavTile[],
	},
	{
		heading: "Service & Engagement",
		tiles: [
			{ title: "Grievances", href: "/crm/grievances", description: "Citizen and vendor grievance tracking" },
			{ title: "Service Requests", href: "/crm/service-requests", description: "Support requests and resolutions" },
			{ title: "Campaigns", href: "/crm/campaigns", description: "Outreach campaign performance" },
			{ title: "Voice of Customer", href: "/crm/voice-of-customer", description: "Feedback and sentiment" },
			{ title: "Account Health", href: "/crm/health", description: "Relationship health scores" },
			{ title: "Control Tower", href: "/crm/control-tower", description: "Real-time operations overview" },
			{ title: "Website Lead Forms", href: "/crm/lead-forms", description: "Public form submissions" },
		] as NavTile[],
	},
	{
		heading: "Products & Pricing",
		tiles: [
			{ title: "Product Catalogue", href: "/crm/products", description: "Services and offerings" },
			{ title: "Price Books", href: "/crm/price-books", description: "Rate cards and pricing tiers" },
			{ title: "Documents", href: "/crm/documents", description: "Shared documents and attachments" },
			{ title: "Document Types", href: "/crm/document-types", description: "Document classification" },
		] as NavTile[],
	},
	{
		heading: "Configuration",
		tiles: [
			{ title: "Custom Fields", href: "/crm/custom-fields", description: "Extend data model" },
			{ title: "Matching Rules", href: "/crm/dedup-rules", description: "Deduplication logic" },
			{ title: "Lead Scoring", href: "/crm/lead-scoring", description: "Automated lead prioritisation" },
			{ title: "Qualification Frameworks", href: "/crm/qualification-frameworks", description: "Deal qualification criteria" },
			{ title: "Lead Stage Reasons", href: "/crm/lead-reason-codes", description: "Stage transition reasons" },
			{ title: "Assignment Rules", href: "/crm/assignment-rules", description: "Auto-assign logic" },
			{ title: "Assignment Directory", href: "/crm/assignment-directory", description: "Agent mapping" },
			{ title: "Agent Workload", href: "/crm/agent-workload", description: "Capacity and utilisation" },
			{ title: "Escalation Rules", href: "/crm/escalation-rules", description: "SLA breach escalation" },
			{ title: "Task Escalation", href: "/crm/task-escalation", description: "Overdue task routing" },
			{ title: "Connected Accounts", href: "/crm/linked-accounts", description: "External integrations" },
			{ title: "Data Quality", href: "/crm/data-quality", description: "Data completeness scoring" },
		] as NavTile[],
	},
];

export default function Page() {
	return (
		<>
			<PageHeader
				title="CRM"
				subtitle="Pipeline and customer operations workspace."
			/>
			<div className="space-y-6">
				{sections.map((section) => (
					<section key={section.heading} aria-labelledby={`crm-section-${section.heading.toLowerCase().replace(/\s+/g, "-")}`}>
						<h2
							id={`crm-section-${section.heading.toLowerCase().replace(/\s+/g, "-")}`}
							className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1"
						>
							{section.heading}
						</h2>
						<LinkTiles tiles={section.tiles} />
					</section>
				))}
			</div>
		</>
	);
}
