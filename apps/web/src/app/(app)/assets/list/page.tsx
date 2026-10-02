import Link from "next/link";
import { getAssets } from "../../../_data/loaders";
import { PageHeader } from "../../../_components/ds";
import { AssetsTable } from "./AssetsTable";

// GAP-ASSETS-LIST-01: this register lists ALL asset types, so it is the
// "Asset Register" -- the fixed-only register lives at /assets/fixed-assets.
export default async function AssetListPage() {
  const { data: assets, source, truncated } = await getAssets();

  return (
    <>
      <PageHeader
        title="Asset Register"
        subtitle="All assets with status and valuation."
        actions={
          <>
            <Link href="/assets/bulk-import" className="btn ghost">Bulk import</Link>
            <Link href="/assets/register" className="btn primary">+ Register Asset</Link>
          </>
        }
      />
      {truncated ? (
        <p role="status" className="banner" style={{ fontSize: 13, color: "var(--warn)", margin: "0 0 12px" }}>
          Showing the first 5,000 assets only. Narrow the list with the filter, or use a more specific register, to see the rest.
        </p>
      ) : null}
      {/* Stats, badge and table all live in AssetsTable and read the same rows. */}
      <AssetsTable assets={assets} source={source} cacheKey="assets.register" heading="Asset register" />
    </>
  );
}
