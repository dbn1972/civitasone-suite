import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";

export default function EmployeesLoading() {
  return (
    <>
      <PageHeader
        title="Employee Directory"
        subtitle="All staff, grades and posting locations."
        back="/hr"
        backLabel="HR"
      />
      <main className="page-main wrap">
        <SkeletonTable rows={10} />
      </main>
    </>
  );
}
