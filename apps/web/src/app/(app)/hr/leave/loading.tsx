import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";

export default function LeaveLoading() {
  return (
    <>
      <PageHeader
        title="Leave Management"
        subtitle="Review and process employee leave requests."
        back="/hr"
        backLabel="HR"
      />
      <main className="page-main wrap">
        <SkeletonTable rows={8} />
      </main>
    </>
  );
}
