import { PageHeader } from "../../../_components/ds";
import { getProcurementGem } from "../../../_data/loaders";
import { GemTable } from "./GemTable";

export default async function GemPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // GAP2-PROCUREMENT-GEM-ITEMS-08: the search term is driven from the URL (?q=)
  // so a server render reflects the operator's query and the loader can hit the
  // live GeM catalog.
  const rawQ = searchParams?.q;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ)?.trim() ?? "";
  const { data: items, source, integrationDisabled, reason } = await getProcurementGem(q);

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

      <GemTable
        items={items}
        source={source}
        query={q}
        integrationDisabled={integrationDisabled ?? false}
        reason={reason ?? null}
      />
    </>
  );
}
