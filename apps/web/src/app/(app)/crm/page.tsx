import { getTranslations } from "next-intl/server";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getSessionRoles, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

// Stable section keys map to crm.hub.sections.* / crm.hub.tiles.* i18n keys.
// Hrefs stay static; only the user-facing labels are translated
// (GAP-CRM-HOME-03).
const CONFIGURATION_SECTION = "configuration";

interface TileDef {
	tileKey: string;
	href: string;
}

interface SectionDef {
	sectionKey: string;
	tiles: TileDef[];
}

const sections: SectionDef[] = [
	{
		sectionKey: "core",
		tiles: [
			{ tileKey: "dashboard", href: "/crm/dashboard" },
			{ tileKey: "contacts", href: "/crm/contacts" },
			{ tileKey: "accounts", href: "/crm/accounts" },
			{ tileKey: "deals", href: "/crm/deals" },
			{ tileKey: "activities", href: "/crm/activities" },
		],
	},
	{
		sectionKey: "pipeline",
		tiles: [
			{ tileKey: "pipelineBoard", href: "/crm/pipeline" },
			{ tileKey: "pipelines", href: "/crm/pipelines" },
			{ tileKey: "opportunities", href: "/crm/opportunities" },
			{ tileKey: "ageing", href: "/crm/opportunity-ageing" },
			{ tileKey: "forecast", href: "/crm/forecast" },
			{ tileKey: "quotations", href: "/crm/quotations" },
			{ tileKey: "onboarding", href: "/crm/onboarding" },
		],
	},
	{
		sectionKey: "service",
		tiles: [
			{ tileKey: "grievances", href: "/crm/grievances" },
			{ tileKey: "serviceRequests", href: "/crm/service-requests" },
			{ tileKey: "campaigns", href: "/crm/campaigns" },
			{ tileKey: "voiceOfCustomer", href: "/crm/voice-of-customer" },
			{ tileKey: "health", href: "/crm/health" },
			{ tileKey: "controlTower", href: "/crm/control-tower" },
			{ tileKey: "leadForms", href: "/crm/lead-forms" },
		],
	},
	{
		sectionKey: "products",
		tiles: [
			{ tileKey: "products", href: "/crm/products" },
			{ tileKey: "priceBooks", href: "/crm/price-books" },
			{ tileKey: "documents", href: "/crm/documents" },
			{ tileKey: "documentTypes", href: "/crm/document-types" },
			{ tileKey: "serviceTypes", href: "/crm/service-types" },
			{ tileKey: "grievanceCategories", href: "/crm/grievance-categories" },
		],
	},
	{
		sectionKey: CONFIGURATION_SECTION,
		tiles: [
			{ tileKey: "customFields", href: "/crm/custom-fields" },
			{ tileKey: "dedupRules", href: "/crm/dedup-rules" },
			{ tileKey: "leadScoring", href: "/crm/lead-scoring" },
			{ tileKey: "qualificationFrameworks", href: "/crm/qualification-frameworks" },
			{ tileKey: "leadReasonCodes", href: "/crm/lead-reason-codes" },
			{ tileKey: "assignmentRules", href: "/crm/assignment-rules" },
			{ tileKey: "assignmentDirectory", href: "/crm/assignment-directory" },
			{ tileKey: "agentWorkload", href: "/crm/agent-workload" },
			{ tileKey: "escalationRules", href: "/crm/escalation-rules" },
			{ tileKey: "taskEscalation", href: "/crm/task-escalation" },
			{ tileKey: "linkedAccounts", href: "/crm/linked-accounts" },
			{ tileKey: "dataQuality", href: "/crm/data-quality" },
		],
	},
];

export default async function Page() {
	const t = await getTranslations("crm.hub");
	// The Configuration section links to platform-wide admin-config routes
	// (each gated by its own layout). Non-admins are redirected if they open
	// one, so don't surface the tiles to them in the first place
	// (GAP-CRM-AGENT-WORKLOAD-01).
	const isAdmin = getSessionRoles().some((r) => CRM_ADMIN_ROLES.includes(r));
	const visibleSections = sections.filter(
		(section) => isAdmin || section.sectionKey !== CONFIGURATION_SECTION,
	);
	return (
		<>
			<PageHeader title={t("title")} subtitle={t("subtitle")} />
			<div className="space-y-6">
				{visibleSections.map((section) => {
					const heading = t(`sections.${section.sectionKey}`);
					const tiles: NavTile[] = section.tiles.map((tile) => ({
						title: t(`tiles.${tile.tileKey}.title`),
						href: tile.href,
						description: t(`tiles.${tile.tileKey}.description`),
					}));
					return (
						<section
							key={section.sectionKey}
							aria-labelledby={"crm-section-" + section.sectionKey}
						>
							<h2
								id={"crm-section-" + section.sectionKey}
								className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3 px-1"
							>
								{heading}
							</h2>
							<LinkTiles tiles={tiles} />
						</section>
					);
				})}
			</div>
		</>
	);
}
