import { PageHeader } from "../../../_components/ds";
import { getProcurementGem } from "../../../_data/loaders";
import { GemTable } from "./GemTable";

export default async function GemPage() {
  const { data: items, source } = await getProcurementGem();

  return (
    <>
      {/* GAP-PROCUREMENT-GEM-03: retitled "GeM Orders" — there is no live
          two-way GeM sync on this surface yet, so "Integration" overclaimed.
          GAP-PROCUREMENT-GEM-01/02/04/05: stats, the error/empty state, spend
          and status buckets all live in the client component, derived from the
          SAME useSeededResource read, so a failed fetch never reads as "no GeM
          orders" and the cards reconcile to the order count. */}
      <PageHeader
        title="GeM Orders"
        subtitle="Government e-Marketplace orders and delivery tracking."
      />

      <GemTable items={items} source={source} />
    </>
  );
}
