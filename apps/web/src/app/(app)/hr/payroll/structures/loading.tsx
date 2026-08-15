import { SkeletonTable } from "../../../../_components/ds";
import { PageHeader } from "../../../../_components/ds";

export default function Loading() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Structures"
        subtitle="Define earning and deduction components that make up an employee's pay."
        back="/hr/payroll"
      />
      <SkeletonTable rows={6} />
    </main>
  );
}
