import Link from "next/link";
import { useDays, useMonthEnds } from "./useDays";

interface Props {
  daysLeft: number;
  monthName: string;
  headcount: number | null;
  // GAP-HR-DASHBOARD-05: mirrors hr/payroll/page.tsx's own canAdminister
  // check (payroll_admin/payroll_officer/super_admin) -- hides "Start Run"
  // for a manager (this banner's own HR_DASHBOARD_READER_ROLES audience
  // includes "manager") who'd only reach a dead-end PermissionDenied wall
  // from it, since /hr/payroll hides its own run-payroll form for anyone
  // outside that same role set.
  canRunPayroll: boolean;
}

export function PayrollBanner({ daysLeft, monthName, headcount, canRunPayroll }: Props) {
  const formatDays = useDays();
  // GAP-HR-DASHBOARD-05: this line used to say "Deadline in N days", which
  // presented calendar days to month-end as a payroll deadline. The app has no
  // payroll cutoff calendar to source a real one from, so it now says what it
  // actually counts.
  const monthEnds = useMonthEnds();
  return (
    // GAP-HR-DASHBOARD-05: role="status" (polite), not role="alert"
    // (assertive) -- an approaching payroll deadline is informational, not
    // an urgent interruption on every single HR-staff page load. Also now
    // only rendered at all when daysLeft <= 7 (see page.tsx).
    <div className="payroll-banner" role="status" aria-label="Payroll deadline notice" data-testid="payroll-banner">
      <div className="pb-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
      </div>
      <div className="pb-text">
        <div className="pb-label">Payroll Processing</div>
        <div className="pb-sub">{monthName} cycle · {headcount != null ? headcount.toLocaleString("en-IN") : "—"} employees · {monthEnds(formatDays(daysLeft))}</div>
      </div>
      {canRunPayroll && <Link href="/hr/payroll" className="pb-btn">Start Run →</Link>}
    </div>
  );
}
