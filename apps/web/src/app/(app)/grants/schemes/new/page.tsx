import { PageHeader } from "../../../../_components/ds";
import { CreateSchemeForm } from "./CreateSchemeForm";

export default function NewGrantSchemePage() {
  return (
    <div className="wrap">
      <PageHeader
        title="New Grant Scheme"
        subtitle="Create a new government grant scheme for disbursement."
        back="/grants/schemes"
        backLabel="Grant Schemes"
      />
      <CreateSchemeForm />
    </div>
  );
}
