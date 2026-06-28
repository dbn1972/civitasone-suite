import { PageHeader } from "../../../_components/ds";
import { MigrationPanel } from "./MigrationPanel";

export default function MigrationPage() {
  return (
    <>
      <PageHeader
        title="Paper → Electronic Migration"
        subtitle="Register legacy physical files, attach scans, and link them to their new eFile."
        back="/estab/list"
      />
      <MigrationPanel />
    </>
  );
}
