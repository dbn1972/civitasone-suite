import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";
import { getSessionRoles, hasAnyRole, CRM_CONTACT_READ_ROLES } from "@/lib/auth/roleGuard";
import { ML_EXPORT_ROLES } from "../_access";

export default async function LeadsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("leads");
  const roles = getSessionRoles();
  const canExport = hasAnyRole(roles, ML_EXPORT_ROLES);
  // The scored entity is a person (CRM contact). Offer the drill-through only to
  // viewers who also hold a CRM read role; others see the score without a path
  // to the personal record. GAP-ANALYTICS-ML-INSIGHTS-LEADS-05 (DPDP).
  const canOpenContact = hasAnyRole(roles, CRM_CONTACT_READ_ROLES);

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
      canLinkRows={canOpenContact}
      canExport={canExport}
      statLabels={{
        predictions: "Leads Scored",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
