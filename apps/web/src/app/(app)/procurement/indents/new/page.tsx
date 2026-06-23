import { PageHeader } from "../../../../_components/ds";
import { CreateIndentForm } from "./CreateIndentForm";

export default function NewIndentPage() {
  return (
    <>
      <PageHeader
        title="New Purchase Indent"
        subtitle="Submit a material requisition for workflow approval."
        back="/procurement/indents"
      />
      <CreateIndentForm />
    </>
  );
}
