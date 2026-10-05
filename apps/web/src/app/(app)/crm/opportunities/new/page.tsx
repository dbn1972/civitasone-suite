import { PageHeader } from "../../../../_components/ds";
import { NewOpportunityClient } from "./NewOpportunityClient";

/** OP-003 — create an opportunity with value/probability/product/etc. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="New Opportunity"
        subtitle="Capture value, probability, product, quantity, competitors, next step and expected close date on a pipeline stage."
        back="/crm/opportunities"
        backLabel="Opportunities"
      />
      <NewOpportunityClient />
    </>
  );
}
