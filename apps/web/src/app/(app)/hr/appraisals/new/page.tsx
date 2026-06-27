import { getEmployees } from "../../../../_data/loaders";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { NewAppraisalForm } from "./NewAppraisalForm";

export default async function NewAppraisalPage() {
  const { data: employees, source } = await getEmployees();

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New Appraisal"
        subtitle="Create a performance review record."
        back="/hr/appraisals"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <NewAppraisalForm employees={employees} />
    </main>
  );
}
