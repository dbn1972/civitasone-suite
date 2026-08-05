import { PageHeader } from "../../../_components/ds";
import { DocumentTypesEditor } from "../../../_components/crm/DocumentTypesEditor";

/** DM-002 — document types admin: mandatory / expiry / verification flags. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Document Types"
        subtitle="The catalogue of document types clerks can attach to a record — which records they apply to, and whether each is mandatory, expiry-tracked or must be verified."
        back="/crm"
        backLabel="CRM"
      />
      <DocumentTypesEditor />
    </>
  );
}
