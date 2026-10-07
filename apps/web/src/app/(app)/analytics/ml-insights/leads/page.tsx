import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { ML_EXPORT_ROLES } from "../_access";

export default async function LeadsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("leads");
  const canExport = hasAnyRole(getSessionRoles(), ML_EXPORT_ROLES);

  return (
    <DomainInsightPage
      title="Lead Scoring Insights"
      subtitle="Logistic regression model performance for lead conversion probability predictions."
      domain="leads"
      evaluation={evaluation}
      source={source}
      // A CRM lead is a row in crm.contacts (crm.lead.created carries contactId),
      // so lead predictions drill through to the contact record (route exists).
      // crm-service enforces its own role on GET /crm/contacts/:id — the real
      // control. GAP-ANALYTICS-ML-INSIGHTS-LEADS-05 (HUMAN REVIEW: DPDP).
      rowLinkPrefix="/crm/contacts/"
      canExport={canExport}
      statLabels={{
        predictions: "Leads Scored",
        accuracy: "AUC-ROC",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
