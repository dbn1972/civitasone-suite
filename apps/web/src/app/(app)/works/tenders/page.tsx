import Link from "next/link";
import { PageHeader, Card } from "@/app/_components/ds";
import { getTenders, getTenderTypeNameMap, getAuthorityNameMap, resolveTenderNames } from "../_data/loaders";
import { TendersTable } from "./TendersTable";

export default async function TendersPage() {
  // GAP-WORKS-TENDERS-02/NEW-03: resolve type/authority ids to real master
  // names web-side (no cross-module service join). GAP-WORKS-TENDERS-03: the
  // stat cards now live inside TendersTable and are computed from the SAME
  // useSeededResource rows, so they can never disagree with the table (an
  // offline/cached table no longer shows rows while the cards read 0).
  const [tendersResult, typeMapResult, authorityMapResult] = await Promise.all([
    getTenders(),
    getTenderTypeNameMap(),
    getAuthorityNameMap(),
  ]);
  const { data: tenders, source } = tendersResult;
  const resolved = resolveTenderNames(tenders, typeMapResult.data, authorityMapResult.data);

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
        <TendersTable tenders={resolved} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
