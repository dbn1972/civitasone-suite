import { PageHeader } from "../../../../_components/ds";
import { CreateTenderForm } from "./CreateTenderForm";

export default function NewTenderPage() {
  return (
    <>
      <PageHeader
        title="New Tender"
        subtitle="Float an open, limited, single-source, or GeM tender. It enters the procurement workflow."
        back="/procurement/tenders"
      />
      <CreateTenderForm />
    </>
  );
}
