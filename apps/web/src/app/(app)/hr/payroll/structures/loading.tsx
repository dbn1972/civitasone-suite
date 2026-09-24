import { SkeletonTable } from "../../../../_components/ds";
import { PageHeader } from "../../../../_components/ds";

export default function Loading() {
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Structures"
        subtitle="Define earning and deduction components that make up an employee's pay."
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <SkeletonTable rows={6} />
    </div>
  );
}
