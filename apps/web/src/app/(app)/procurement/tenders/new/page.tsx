import { PageHeader } from "../../../../_components/ds";
import { CreateTenderForm } from "./CreateTenderForm";

export default function NewTenderPage() {
  return (
    <>
      <PageHeader
        title="New Tender"
        subtitle="Create an open, limited, single-source, or GeM tender as a draft. Attach the NIT and publish it afterwards."
        back="/procurement/tenders"
      />
      <CreateTenderForm />
    </>
  );
}
