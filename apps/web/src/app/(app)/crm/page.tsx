import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * Roles allowed to see the admin-config section (and reach the gated routes
 * behind it, e.g. Agent Workload). Mirrors the ALLOWED_ROLES in the CRM
 * admin-config layouts (assignment-rules, agent-workload, …) so the hub tiles
 * and the route guards agree (GAP-CRM-AGENT-WORKLOAD-01).
 */
const CRM_ADMIN_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

const CONFIGURATION_HEADING = "Configuration";

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
			{ title: "Procurement Pipeline Forecast", href: "/crm/forecast", description: "Pipeline procurement projections" },
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
		heading: CONFIGURATION_HEADING,
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

export default async function Page() {
	const t = await getTranslations("crm");
	// The Configuration section links to platform-wide admin-config routes
	// (each gated by its own layout). Non-admins are redirected if they open
	// one, so don't surface the tiles to them in the first place
	// (GAP-CRM-AGENT-WORKLOAD-01).
	const isAdmin = getSessionRoles().some((r) => CRM_ADMIN_ROLES.includes(r));
	const visibleSections = sections.filter(
		(section) => isAdmin || section.heading !== CONFIGURATION_HEADING,
	);
	return (
		<>
			<PageHeader
				title={t("title")}
				subtitle="Pipeline and customer operations workspace."
			/>
			<div className="space-y-6">
				{visibleSections.map((section) => (
					<section key={section.heading} aria-labelledby={"crm-section-" + section.heading.toLowerCase().replace(/\s+/g, "-")}>
						<h2
							id={"crm-section-" + section.heading.toLowerCase().replace(/\s+/g, "-")}
							className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3 px-1"
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
