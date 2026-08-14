import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";

export default function AttendanceLoading() {
  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Daily presence, check-in and check-out records."
        back="/hr"
        backLabel="HR"
      />
      <main className="page-main wrap">
        <SkeletonTable rows={8} />
      </main>
    </>
  );
}
