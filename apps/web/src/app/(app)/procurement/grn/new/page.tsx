import { PageHeader } from "../../../../_components/ds";
import { CreateGRNForm } from "./CreateGRNForm";
import { getInventoryStoreOptions } from "../../../inventory/_data";

// DOM-002 — this page used to decode the current user's own session token
// and pass it down as `inspectorId`, so the form could submit an inline
// inspection verdict "from" the receiving user themselves. Inspection is now
// a genuinely separate step performed by a different, independently
// authenticated user from the GRN detail page (see InspectGrnForm.tsx), so
// this page no longer needs to know who's logged in at all.
export default async function NewGRNPage() {
  // UAT b10 F95: the receiving-store picker (GET /inventory/stores); an empty list still renders the form.
  const stores = await getInventoryStoreOptions();
  return (
    <>
      <PageHeader
        title="New Goods Receipt Note"
        subtitle="Record received quantities. A separate officer inspects and accepts or rejects the GRN afterwards — three-way match is computed on that decision."
        back="/procurement/grn"
      />
      <CreateGRNForm stores={stores.data} />
    </>
  );
}
