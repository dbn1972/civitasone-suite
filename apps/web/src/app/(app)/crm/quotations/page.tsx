import { PageHeader } from "../../../_components/ds";
import { QuotationBuilder } from "../../../_components/crm/QuotationBuilder";

/** QP-003/004/005 — quotation builder, approvals, versions, convert to order. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle="Build quotations from the catalogue with price-book pricing and tax, request discount/deviation approvals, track versions, accept/reject and convert to an order."
        back="/crm"
        backLabel="CRM"
      />
      <QuotationBuilder />
    </>
  );
}
