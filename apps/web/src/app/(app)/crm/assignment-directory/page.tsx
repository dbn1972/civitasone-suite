import { PageHeader } from "../../../_components/ds";
import { OwnershipDirectoryEditor } from "../../../_components/crm/OwnershipDirectoryEditor";

/** AS-002 admin — queues, territories, partners and branches for assignment. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Assignment Directory"
        subtitle="Manage the queues, territories, partners and branches that own and route leads."
        back="/crm"
        backLabel="CRM"
      />
      <OwnershipDirectoryEditor />
    </>
  );
}
