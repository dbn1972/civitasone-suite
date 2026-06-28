import { PageHeader } from "../../../_components/ds";
import { OperatorsPanel } from "./OperatorsPanel";

export default function OperatorsPage() {
  return (
    <>
      <PageHeader
        title="eOffice File Operators"
        subtitle="Division admins enrol the employees who may hold and operate eOffice files. Only enrolled operators can be marked a file."
        back="/estab/list"
      />
      <OperatorsPanel />
    </>
  );
}
