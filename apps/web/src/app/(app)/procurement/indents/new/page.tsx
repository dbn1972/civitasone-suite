import { PageHeader } from "../../../../_components/ds";
import { CreateIndentForm } from "./CreateIndentForm";
import { parseIndentPrefill } from "./prefill";

export default function NewIndentPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // GAP-INVENTORY-LOW-STOCK-03: the inventory low-stock "Raise indent" link
  // prefills the first line item (item code, description, suggested quantity).
  const prefill = parseIndentPrefill(searchParams ?? {});
  return (
    <>
      <PageHeader
        title="New Purchase Indent"
        subtitle="Submit a material requisition for workflow approval."
        back="/procurement/indents"
      />
      <CreateIndentForm initialItem={prefill?.item ?? null} prefillTruncated={prefill?.truncated ?? false} />
    </>
  );
}
