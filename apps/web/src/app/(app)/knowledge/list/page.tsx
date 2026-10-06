import { redirect } from "next/navigation";

/**
 * GAP-KNOWLEDGE-LIST-03: /knowledge/list was a near-duplicate of /knowledge/repository
 * (same loader, same table with fewer columns, different status labels). Repository is
 * the canonical list. This page now redirects to it to prevent orphan bookmarks.
 *
 * Decision: repository is canonical; list is retired. The Access column and stats
 * from list were folded into repository by the repository fixes (REPOSITORY-01/03).
 */
export default function KnowledgeListPage() {
  redirect("/knowledge/repository");
}
