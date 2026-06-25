import { PageHeader } from "../../../../_components/ds";
import { CreateRFQForm } from "./CreateRFQForm";

export default function NewRFQPage() {
  return (
    <>
      <PageHeader
        title="New Request for Quotation"
        subtitle="Issue an RFQ against an approved indent and invite vendors to quote."
        back="/procurement/rfq"
      />
      <CreateRFQForm />
    </>
  );
}
