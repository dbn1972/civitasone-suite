import { getAssets } from "../../../_data/loaders";
import { PageHeader } from "../../../_components/ds";
import { AssetsTable } from "./AssetsTable";

// GAP-ASSETS-LIST-01: this register lists ALL asset types, so it is the
// "Asset Register" -- the fixed-only register lives at /assets/fixed-assets.
export default async function AssetListPage() {
  const { data: assets, source } = await getAssets();

  return (
    <>
      <PageHeader
        title="Asset Register"
        subtitle="All assets with status and valuation."
        actions={
          <>
            <a href="/assets/bulk-import" className="btn ghost">Bulk import</a>
            <a href="/assets/register" className="btn primary">+ Register Asset</a>
          </>
        }
      />
      {/* Stats, badge and table all live in AssetsTable and read the same rows. */}
      <AssetsTable assets={assets} source={source} cacheKey="assets.register" heading="Asset register" />
    </>
  );
}
