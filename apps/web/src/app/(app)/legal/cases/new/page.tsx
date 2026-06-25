import { PageHeader } from "../../../../_components/ds";
import { CreateCaseForm } from "./CreateCaseForm";

export default function NewLegalCasePage() {
  return (
    <div className="wrap">
      <PageHeader
        title="New Legal Case"
        subtitle="Register a litigation matter across courts & tribunals."
        back="/legal/list"
      />
      <CreateCaseForm />
    </div>
  );
}
