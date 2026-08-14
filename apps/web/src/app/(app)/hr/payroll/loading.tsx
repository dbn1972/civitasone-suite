import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";

export default function PayrollLoading() {
  return (
    <>
      <PageHeader
        title="Payroll Runs"
        subtitle="Monthly salary processing and statutory run status."
        back="/hr"
        backLabel="HR"
      />
      <main className="page-main wrap">
        <SkeletonTable rows={6} />
      </main>
    </>
  );
}
