import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getAnalyticsDashboards } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getAnalyticsDashboards();
  return (
    <ModuleListPage
      title="Analytics — Dashboards"
      description="Read-only list loaded from the Analytics service API."
      rows={data}
      source={source}
    />
  );
}
