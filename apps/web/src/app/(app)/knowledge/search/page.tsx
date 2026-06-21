import { getKnowledgeDocs } from "../../../_data/loaders";
import { KnowledgeSearchClient } from "./SearchClient";

export default async function KnowledgeSearchPage() {
  const { data: docs } = await getKnowledgeDocs();
  return <KnowledgeSearchClient initialDocs={docs} />;
}
