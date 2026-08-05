import { PageHeader } from "../../../_components/ds";
import { PriceBookEditor } from "../../../_components/crm/PriceBookEditor";

/** QP-002 — price books + resolve which book applies for given criteria. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Price Books"
        subtitle="Segment / currency / geography / channel price books, and a resolver that shows which book applies for a set of criteria."
        back="/crm"
        backLabel="CRM"
      />
      <PriceBookEditor />
    </>
  );
}
