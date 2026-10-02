import { getFixedAssets } from "../../../_data/loaders";
import { PageHeader } from "../../../_components/ds";
import { AssetsTable } from "../list/AssetsTable";

// GAP-ASSETS-FIXED-ASSETS-01: same implementation as /assets/list (shared
// AssetsTable: stats, offline cache, provenance badge), restricted to type
// "fixed" -- no second copy of the stats/table code.
export default async function FixedAssetsPage() {
  const { data: assets, source } = await getFixedAssets();

  return (
    <>
      <PageHeader
        title="Fixed Asset Register"
        subtitle="Fixed assets — capitalised from GRN or registered manually."
        actions={
          <>
            <a href="/assets/bulk-import" className="btn ghost">Bulk import</a>
            <a href="/assets/register" className="btn primary">+ Register Asset</a>
          </>
        }
      />
      <div
        className="banner"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--warn)",
          color: "var(--warn)",
          borderRadius: 12,
          padding: "13px 16px",
          marginBottom: 18,
          fontSize: 13,
        }}
      >
        <span aria-hidden="true">🔗</span> <b>Auto-capitalised from Procurement GRN.</b> Accepted capital goods create asset records here; depreciation posts to Finance.
      </div>
      <AssetsTable assets={assets} source={source} cacheKey="assets.fixed" typeFilter="fixed" heading="Fixed asset register" />
    </>
  );
}
