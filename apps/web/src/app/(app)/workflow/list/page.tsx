import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getWorkflowInstances } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getWorkflowInstances();
  return (
    <ModuleListPage
      title="Workflow — Instances"
      description="Read-only list loaded from the Workflow service API."
      rows={data}
      source={source}
    />
  );
}
