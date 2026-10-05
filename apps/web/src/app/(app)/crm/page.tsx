import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

const CONFIGURATION_HEADING = "Configuration";

// New hub entries (engagement vocabulary, service/grievance masters) are
// translated; `id` keeps the section anchor stable across locales.
function buildSections(t: (key: string) => string) {
	return [
	{
		id: "Core",
		heading: "Core",
		tiles: [
			{ title: "Dashboard", href: "/crm/dashboard", description: "Overview metrics and activity" },
			{ title: "Contacts", href: "/crm/contacts", description: "Vendor, beneficiary, and stakeholder contacts" },
			{ title: "Accounts", href: "/crm/accounts", description: "Organisations and institutions" },
			{ title: t("tileEngagements"), href: "/crm/deals", description: "Engagements and procurement opportunities" },
			{ title: "Activities", href: "/crm/activities", description: "Calls, meetings, and follow-ups" },
		] as NavTile[],
	},
	{
		id: "Engagement Pipeline",
		heading: t("sectionEngagementPipeline"),
		tiles: [
			{ title: "Pipeline Board", href: "/crm/pipeline", description: "Visual kanban of deal stages" },
			{ title: t("tileEngagementPipelines"), href: "/crm/pipelines", description: "Configure pipeline stages" },
			{ title: "Opportunities", href: "/crm/opportunities", description: "Track opportunity funnel" },
			{ title: "Stage Ageing", href: "/crm/opportunity-ageing", description: "Stale opportunity alerts" },
			{ title: "Procurement Pipeline Forecast", href: "/crm/forecast", description: "Pipeline procurement projections" },
			{ title: "Quotations", href: "/crm/quotations", description: "Quotes and proposals" },
			{ title: "Customer Onboarding", href: "/crm/onboarding", description: "Post-deal onboarding workflows" },
		] as NavTile[],
	},
	{
		id: "Service & Engagement",
		heading: "Service & Engagement",
		tiles: [
			{ title: "Grievances", href: "/crm/grievances", description: "Citizen and vendor grievance tracking" },
			{ title: "Service Requests", href: "/crm/service-requests", description: "Support requests and resolutions" },
			{ title: "Campaigns", href: "/crm/campaigns", description: "Outreach campaign performance" },
			{ title: t("tileVoiceOfCitizen"), href: "/crm/voice-of-customer", description: "Feedback and sentiment" },
			{ title: "Account Health", href: "/crm/health", description: "Relationship health scores" },
			{ title: "Control Tower", href: "/crm/control-tower", description: "Real-time operations overview" },
			{ title: "Website Lead Forms", href: "/crm/lead-forms", description: "Public form submissions" },
		] as NavTile[],
	},
	{
		id: "Products & Pricing",
		heading: "Products & Pricing",
		tiles: [
			{ title: "Product Catalogue", href: "/crm/products", description: "Services and offerings" },
			{ title: "Price Books", href: "/crm/price-books", description: "Rate cards and pricing tiers" },
			{ title: "Documents", href: "/crm/documents", description: "Shared documents and attachments" },
			{ title: "Document Types", href: "/crm/document-types", description: "Document classification" },
			{ title: t("tileServiceTypes"), href: "/crm/service-types", description: t("tileServiceTypesDesc") },
			{ title: t("tileGrievanceCategories"), href: "/crm/grievance-categories", description: t("tileGrievanceCategoriesDesc") },
		] as NavTile[],
	},
	{
		id: CONFIGURATION_HEADING,
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
}

export default async function Page() {
	const t = await getTranslations("crm");
	// The Configuration section links to platform-wide admin-config routes
	// (each gated by its own layout). Non-admins are redirected if they open
	// one, so don't surface the tiles to them in the first place
	// (GAP-CRM-AGENT-WORKLOAD-01).
	const isAdmin = getSessionRoles().some((r) => CRM_ADMIN_ROLES.includes(r));
	const visibleSections = buildSections((key) => t(key)).filter(
		(section) => isAdmin || section.id !== CONFIGURATION_HEADING,
	);
	return (
		<>
			<PageHeader
				title={t("title")}
				subtitle={t("hubSubtitle")}
			/>
			<div className="space-y-6">
				{visibleSections.map((section) => (
					<section key={section.id} aria-labelledby={"crm-section-" + section.id.toLowerCase().replace(/\s+/g, "-")}>
						<h2
							id={"crm-section-" + section.id.toLowerCase().replace(/\s+/g, "-")}
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
