import { PageHeader } from "../../../../_components/ds";
import { CreatePOForm } from "./CreatePOForm";

export default function NewPOPage() {
  return (
    <>
      <PageHeader
        title="New Purchase Order"
        subtitle="Issue a PO — it enters the procurement approval workflow before dispatch."
        back="/procurement/orders"
      />
      <CreatePOForm />
    </>
  );
}
