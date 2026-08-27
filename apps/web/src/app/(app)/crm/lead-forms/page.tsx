import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getCrmLeadCaptureForms } from "../../../_data/loaders";
import { LeadFormsTable } from "./LeadFormsTable";
import { formHealth, rankForms } from "./leadForms";

export const dynamic = "force-dynamic";

export default async function LeadFormsPage() {
  const { data: forms, source } = await getCrmLeadCaptureForms();
  const ranked = rankForms(forms);
  const live = forms.filter((f) => formHealth(f) === "live").length;
  const unlawful = forms.filter((f) => formHealth(f) === "unlawful").length;

  // Never fabricate a 0 count when the list load failed — show "—" instead
  // (matches the pattern already used on dashboard/accounts/contacts).
  const stat = (n: number) => (source === "error" ? "—" : n.toLocaleString("en-IN"));

  return (
    <>
      <PageHeader
        title="Website Lead Forms"
        subtitle="Public form keys that turn website submissions into CRM leads with UTM attribution and consent checks."
        back="/crm"
        backLabel="CRM"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🌐" iconBg="#e0f2fe" label="Forms" value={stat(forms.length)} />
        <StatCard icon="✅" iconBg="#dcfce7" label="Live" value={stat(live)} />
        <StatCard icon="⛔" iconBg="#fee2e2" label="Consent gaps" value={stat(unlawful)} />
      </StatGrid>
      <Card title="Registered forms">
        <LeadFormsTable rows={ranked} />
      </Card>
    </>
  );
}
