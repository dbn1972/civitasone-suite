import { PageHeader, SkeletonTable } from "../../../../_components/ds";

/**
 * Shared loading shell for payroll report pages (GAP-PAYROLL-REGISTER-06,
 * GAP-PAYROLL-DDOS-05): the page's real header plus a table skeleton, so the
 * layout doesn't jump from a bare grey bar to a full page.
 */
export function PayrollPageSkeleton({
  title,
  subtitle,
  backLabel,
  loadingLabel,
  rows = 6,
}: {
  title: string;
  subtitle: string;
  backLabel: string;
  loadingLabel: string;
  rows?: number;
}) {
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader title={title} subtitle={subtitle} back="/hr/payroll" backLabel={backLabel} />
      <div aria-label={loadingLabel} role="status">
        <SkeletonTable rows={rows} />
      </div>
    </div>
  );
}
