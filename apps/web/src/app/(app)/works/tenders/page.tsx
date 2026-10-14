import Link from "next/link";
import { PageHeader, Card } from "@/app/_components/ds";
import {
  getTendersPage,
  getTenderTypeNameMap,
  getAuthorityNameMap,
  resolveTenderNames,
  parsePageParam,
  TENDER_PAGE_SIZE,
} from "../_data/loaders";
import { TendersTable } from "./TendersTable";

export default async function TendersPage({
  searchParams,
}: {
  searchParams?: { page?: string | string[] };
}) {
  const page = parsePageParam(searchParams?.page);
  // GAP-WORKS-TENDERS-02/NEW-03: resolve type/authority ids to real master
  // names web-side (no cross-module service join). GAP-WORKS-TENDERS-03: the
  // stat cards now live inside TendersTable and are computed from the SAME
  // useSeededResource rows, so they can never disagree with the table (an
  // offline/cached table no longer shows rows while the cards read 0).
  const [tendersResult, typeMapResult, authorityMapResult] = await Promise.all([
    getTendersPage(page),
    getTenderTypeNameMap(),
    getAuthorityNameMap(),
  ]);
  const { data: tenderPage, source } = tendersResult;
  const resolved = resolveTenderNames(tenderPage.rows, typeMapResult.data, authorityMapResult.data);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Tender Pipeline"
        subtitle="Pre-tender, quotation, and award management."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href="/works/tenders/new" className="btn primary" style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}>+ New pre-tender</Link>
          </div>
        }
      />
      <Card title="Tenders">
        <TendersTable tenders={resolved} source={source === "error" ? "error" : "api"} totalCount={source === "error" ? undefined : tenderPage.total} />
      </Card>
      {/* GAP-WORKS-TENDERS-DETAIL-03: real server paging so every tender the
          detail page can open is also reachable from the list. */}
      {source !== "error" && tenderPage.total > TENDER_PAGE_SIZE ? (
        <nav aria-label="Tender pages" style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Showing {(page - 1) * TENDER_PAGE_SIZE + 1}–{Math.min(page * TENDER_PAGE_SIZE, tenderPage.total)} of {tenderPage.total}
          </span>
          {page > 1 ? (
            <Link href={`/works/tenders?page=${page - 1}`} className="btn ghost" rel="prev">
              Previous
            </Link>
          ) : null}
          {page * TENDER_PAGE_SIZE < tenderPage.total ? (
            <Link href={`/works/tenders?page=${page + 1}`} className="btn ghost" rel="next">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
