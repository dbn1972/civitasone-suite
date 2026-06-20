import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getContracts } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getContracts();
  return (
    <ModuleListPage
      title="Contracts — Contracts"
      description="Read-only list loaded from the Contracts service API."
      rows={data}
      source={source}
    />
  );
}
