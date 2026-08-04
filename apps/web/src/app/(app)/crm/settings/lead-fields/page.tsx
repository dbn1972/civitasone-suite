import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "@/app/_components/ds";
import { getCrmLeadFieldRules } from "@/app/_data/loaders";
import { LeadFieldRulesTable } from "./LeadFieldRulesTable";

/**
 * Lead field rules (LM-001) — the admin screen for `crm.lead_field_rules`.
 *
 * Server Component: reads the tenant's configuration through the loader, then hands
 * it to a client component for editing. Every governable field is listed, including
 * the ones with no rule yet, because those are exactly the fields an admin cannot
 * otherwise discover.
 */
export default async function Page() {
  const { data: rules, source } = await getCrmLeadFieldRules();

  const configured = rules.filter((r) => r.configured).length;
  const mandatory = rules.filter((r) => r.configured && r.required).length;
  const scored = rules.filter((r) => r.configured && r.enabled).length;

  return (
    <>
      <PageHeader
        title="Lead Field Rules"
        subtitle="Decide which lead fields your organisation insists on, and how much each one counts towards a lead's completeness score."
        back="/crm"
        backLabel="Back to CRM"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🧩" iconBg="#eef2ff" label="Governable Fields" value={String(rules.length)} />
        <StatCard icon="⚙️" iconBg="#eef2ff" label="Configured" value={String(configured)} />
        <StatCard icon="✳️" iconBg="#fef3c7" label="Mandatory" value={String(mandatory)} />
        <StatCard icon="📊" iconBg="#ecfdf5" label="Counted In Score" value={String(scored)} />
      </StatGrid>
      <LeadFieldRulesTable rules={rules} source={source} />
    </>
  );
}
