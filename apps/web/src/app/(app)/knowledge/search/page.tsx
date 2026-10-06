import { getKnowledgeDocs } from "../../../_data/loaders";
import { PageHeader, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { KnowledgeSearchClient } from "./SearchClient";

export default async function KnowledgeSearchPage({ searchParams }: { searchParams?: { q?: string } }) {
  const { data: docs, source } = await getKnowledgeDocs();
  const initialQuery = typeof searchParams?.q === "string" ? searchParams.q : "";

  // GAP-KNOWLEDGE-SEARCH-02: a failed fetch must not read as "No documents found".
  if (source === "error") {
    return (
      <div className="wrap">
        <PageHeader title="Enterprise Search" subtitle="Search document titles, categories, authors and tags." />
        <RefreshErrorState error={toHumanError("load", { area: "documents" })} backHref="/knowledge" />
      </div>
    );
  }

  return <KnowledgeSearchClient initialDocs={docs} initialQuery={initialQuery} />;
}
