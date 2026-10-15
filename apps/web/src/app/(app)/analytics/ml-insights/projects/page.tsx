import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { ML_EXPORT_ROLES } from "../_access";

export default async function ProjectsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("tasks");
  const canExport = hasAnyRole(getSessionRoles(), ML_EXPORT_ROLES);

  return (
    <DomainInsightPage
      title="Task Delay Prediction Insights"
      subtitle="Monte Carlo simulation performance for project task completion-date predictions."
      domain="tasks"
      evaluation={evaluation}
      source={source}
      // The domain scores TASKS but /projects/[id] expects a PROJECT id, so a
      // task entityId must never be the link target. Rows link to the OWNING
      // project's task list via parentId (route exists); a row the API sends
      // without a parentId is plain text, not a link.
      // GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-02.
      parentLinkTemplate="/projects/{parentId}/tasks"
      canExport={canExport}
      statLabels={{
        predictions: "Tasks Scored",
        accuracy: "Prediction Accuracy",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
