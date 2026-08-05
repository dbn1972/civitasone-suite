import { PageHeader } from "../../../_components/ds";
import { CustomFieldsManager } from "./_components/CustomFieldsManager";

/** Custom Fields configuration (crm-service custom-fields module, Req 8.8). */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Custom Fields"
        subtitle="Define extra fields captured on leads, contacts and deals."
        back="/crm"
        backLabel="CRM"
      />
      <CustomFieldsManager />
    </>
  );
}
