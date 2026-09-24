import { PageHeader } from "../../../_components/ds";
import { NewContractForm } from "./NewContractForm";

export default function NewContractPage() {
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New Contract"
        subtitle="Register a new service, supply, or maintenance contract."
        back="/contracts/list"
      />
      <NewContractForm />
    </div>
  );
}
