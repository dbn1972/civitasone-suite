import Link from "next/link";
import { PageHeader } from "@/app/_components/ds";
import { getProposals, getWorkTypeNameMap } from "../_data/loaders";
import { ProposalsView } from "./ProposalsView";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams?: Record<string, string>;
}) {
  // Always fetch the FULL, unfiltered list. Stats, tab counts, the card title
  // and client-side filtering are all derived from this ONE list inside
  // ProposalsView (GAP-WORKS-PROPOSALS-02/03/04) — the page no longer filters
  // server-side by ?status=, which previously left the table, counts and
  // offline cache able to disagree with one another.
  const [{ data: proposals, source }, { data: workTypeNames }] = await Promise.all([
    getProposals(),
    getWorkTypeNameMap(),
  ]);

  // GAP-WORKS-PROPOSALS-01: resolve the work-type id to a readable name so the
  // "Type" column shows "Road Works" (searchable) instead of a UUID prefix.
  // Falls back to "—" when the name is unknown, never a broken id fragment.
  const resolved = proposals.map((p) => {
    const typeId = typeof p.workTypeId === "string" ? p.workTypeId : null;
    const name = typeId ? workTypeNames[typeId] : undefined;
    return { ...p, type: name ?? "—" };
  });

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Work Proposals"
        subtitle="Work registration, categorization, and proposal lifecycle."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href="/works/proposals/new"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + New proposal
            </Link>
          </div>
        }
      />

      <ProposalsView
        proposals={resolved}
        source={source === "error" ? "error" : "api"}
        requestedStatus={searchParams?.status}
      />
    </div>
  );
}
