import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getKnowledgeDocuments } from "../../../_data/loaders";

export default async function Page() {
  const { data, source } = await getKnowledgeDocuments();
  return (
    <ModuleListPage
      title="Knowledge — Documents"
      description="Read-only list loaded from the Knowledge service API."
      rows={data}
      source={source}
    />
  );
}
