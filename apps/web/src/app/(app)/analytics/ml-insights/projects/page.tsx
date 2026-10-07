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
      // Drill-through deliberately unset: the domain scores TASKS, but
      // /projects/[id] expects a PROJECT id, so a task entityId resolved to
      // "Project not found" (or, worse, a wrong project). The owning project
      // id (parentId) is not yet in the evaluations payload; once ms-service
      // returns it, link to /projects/${projectId}/tasks (route exists).
      // GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-02 (HUMAN REVIEW).
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
