import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";

export default async function TicketsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("tickets");

  return (
    <DomainInsightPage
      title="SLA Breach Prediction Insights"
      subtitle="Model performance for helpdesk ticket SLA breach probability predictions."
      domain="tickets"
      evaluation={evaluation}
      source={source}
      rowLinkPrefix="/helpdesk/internal/"
      statLabels={{
        predictions: "Tickets Scored",
        accuracy: "Precision",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
