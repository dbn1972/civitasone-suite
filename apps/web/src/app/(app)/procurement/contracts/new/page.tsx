import { PageHeader } from "../../../../_components/ds";
import { CreateContractForm } from "./CreateContractForm";

export default function NewContractPage() {
  return (
    <>
      <PageHeader
        title="New Contract"
        subtitle="Register a rate or service contract against an empanelled vendor."
        back="/procurement/contracts"
      />
      <CreateContractForm />
    </>
  );
}
