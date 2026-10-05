import { PageHeader } from "../../../_components/ds";
import { getDeals } from "../../../_data/loaders";
import { DealsTable } from "./DealsTable";

export default async function Page() {
  const { data: deals, source } = await getDeals();

  return (
    <>
      <PageHeader
        title="Vendor / Stakeholder Engagements"
        subtitle="Track high-value vendor engagements, procurement opportunities, and government stakeholder interactions • संलग्नताएँ"
        back="/crm"
        actions={
          <a className="btn primary" href="/crm/deals/new">+ New Engagement</a>
        }
      />
      {/* GAP-CRM-DEALS-03/04: the stat cards, the data-source badge and the
          table all live inside DealsTable, driven by one useSeededResource
          call. The page no longer computes figures from a second, independent
          read of the server rows (which could print 0 / ₹0.00 on a failed load
          while the cached table showed real data), and money is summed as
          bigint paise there, not as a JS number here. */}
      <DealsTable deals={deals} source={source} />
    </>
  );
}
