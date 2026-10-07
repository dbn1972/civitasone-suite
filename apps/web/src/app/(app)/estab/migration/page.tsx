import { PageHeader } from "../../../_components/ds";
import { MigrationPanel } from "./MigrationPanel";

export default function MigrationPage() {
  return (
    <>
      <PageHeader
        title="Paper → Electronic Migration"
        subtitle="Register legacy physical files and record their scan reference."
        back="/estab/list"
      />
      <MigrationPanel />
    </>
  );
}
