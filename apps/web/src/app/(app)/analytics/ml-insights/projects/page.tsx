import { getMLDomainEvaluation } from "../_data";
import { DomainInsightPage } from "../_components/DomainInsightPage";

export default async function ProjectsInsightsPage() {
  const { data: evaluation, source } = await getMLDomainEvaluation("tasks");

  return (
    <DomainInsightPage
      title="Project Delay Prediction Insights"
      subtitle="Monte Carlo simulation performance for project task completion date predictions."
      domain="tasks"
      evaluation={evaluation}
      source={source}
      rowLinkPrefix="/projects/"
      statLabels={{
        predictions: "Tasks Scored",
        accuracy: "Prediction Accuracy",
        fallbackRate: "Fallback Rate",
        topFactor: "Top Factor",
      }}
    />
  );
}
