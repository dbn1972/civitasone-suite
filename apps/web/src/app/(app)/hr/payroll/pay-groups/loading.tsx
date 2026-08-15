import { SkeletonTable, PageHeader } from "../../../../_components/ds";

export default function Loading() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Pay Groups"
        subtitle="Groups of employees paid on a common schedule."
        back="/hr/payroll"
      />
      <SkeletonTable rows={4} />
    </main>
  );
}
