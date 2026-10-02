import { PageHeader, SkeletonBar, SkeletonTable } from "../../../../_components/ds";

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
  statCount = 0,
}: {
  title: string;
  subtitle: string;
  backLabel: string;
  loadingLabel: string;
  rows?: number;
  /** GAP-PAYROLL-CORRECTIONS-06 / FLEX-BENEFITS-05: number of stat-tile placeholders above the table (pages with a StatGrid). */
  statCount?: number;
}) {
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader title={title} subtitle={subtitle} back="/hr/payroll" backLabel={backLabel} />
      <div aria-label={loadingLabel} role="status">
        {statCount > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 16 }}>
            {Array.from({ length: statCount }, (_, i) => (
              <SkeletonBar key={i} h={72} style={{ borderRadius: 12 }} />
            ))}
          </div>
        )}
        <SkeletonTable rows={rows} />
      </div>
    </div>
  );
}
