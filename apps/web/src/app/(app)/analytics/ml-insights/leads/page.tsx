import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";

export default async function LeadsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("leads");

  return (
    <DomainInsightPage
      title="Lead Scoring Insights"
      subtitle="Logistic regression model performance for lead conversion probability predictions."
      domain="leads"
      evaluation={evaluation}
      source={source}
      // A CRM lead is a row in crm.contacts (crm.lead.created carries contactId),
      // so lead predictions drill through to the contact record.
      rowLinkPrefix="/crm/contacts/"
      statLabels={{
        predictions: "Leads Scored",
        accuracy: "AUC-ROC",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
