import { PageHeader } from "../../../_components/ds";
import { QualificationFrameworksEditor } from "../../../_components/crm/QualificationFrameworksEditor";

/** LQ-001 admin — qualification frameworks and their questions, per business line. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Qualification Frameworks"
        subtitle="Define per-business-line qualification frameworks and the questions that decide whether a lead qualifies."
        back="/crm"
        backLabel="CRM"
      />
      <QualificationFrameworksEditor />
    </>
  );
}
