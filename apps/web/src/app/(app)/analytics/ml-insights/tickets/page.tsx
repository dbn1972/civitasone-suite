import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { ML_EXPORT_ROLES } from "../_access";

export default async function TicketsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("tickets");
  const canExport = hasAnyRole(getSessionRoles(), ML_EXPORT_ROLES);

  return (
    <DomainInsightPage
      title="SLA Breach Prediction Insights"
      subtitle="Model performance for helpdesk ticket SLA breach probability predictions."
      domain="tickets"
      evaluation={evaluation}
      source={source}
      // Canonical ticket detail is /helpdesk/tickets/[id] (full view with
      // actions + conversation), not the read-only /helpdesk/internal summary.
      // helpdesk-service enforces role/tenant on GET /helpdesk/tickets/:id —
      // the real control. GAP-ANALYTICS-ML-INSIGHTS-TICKETS-05.
      rowLinkPrefix="/helpdesk/tickets/"
      canExport={canExport}
      statLabels={{
        predictions: "Tickets Scored",
        accuracy: "Precision",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
