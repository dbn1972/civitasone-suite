import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLocations } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getLocations();
  return (
    <ModuleListPage
      title="Offices & branches"
      description="Your head office and its branches. Add a branch, or switch on example offices from Getting Started to explore."
      rows={data}
      source={source}
    />
  );
}
