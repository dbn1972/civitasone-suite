import { SkeletonTable } from "../../../../_components/ds";
import { PageHeader } from "../../../../_components/ds";

export default function RegularisationLoading() {
  return (
    <>
      <PageHeader
        title="Attendance Regularisation"
        subtitle="Employee requests to correct attendance records."
        back="/hr/attendance"
      />
      <main className="page-main wrap">
        <SkeletonTable rows={5} />
      </main>
    </>
  );
}
