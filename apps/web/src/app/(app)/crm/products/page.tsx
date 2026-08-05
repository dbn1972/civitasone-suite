import { PageHeader } from "../../../_components/ds";
import { ProductCatalogueEditor } from "../../../_components/crm/ProductCatalogueEditor";

/** QP-001 — product catalogue: tax, price, active window, enabled flag. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Product Catalogue"
        subtitle="Products available for quoting — category, code, unit, tax rate, price and active period. Only enabled, in-window products can be quoted."
        back="/crm"
        backLabel="CRM"
      />
      <ProductCatalogueEditor />
    </>
  );
}
