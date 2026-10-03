import Link from "next/link";
import { useDays } from "./useDays";

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
  return (
    // GAP-HR-DASHBOARD-05: role="status" (polite), not role="alert"
    // (assertive) -- an approaching payroll deadline is informational, not
    // an urgent interruption on every single HR-staff page load. Also now
    // only rendered at all when daysLeft <= 7 (see page.tsx).
    <div className="payroll-banner" role="status" aria-label="Payroll deadline notice" data-testid="payroll-banner">
      <div className="pb-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warn, #d97706)" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
      </div>
      <div className="pb-text">
        <div className="pb-label">Payroll Processing</div>
        <div className="pb-sub">{monthName} cycle · {headcount != null ? headcount.toLocaleString("en-IN") : "—"} employees · Deadline in {formatDays(daysLeft)}</div>
      </div>
      {canRunPayroll && <Link href="/hr/payroll" className="pb-btn">Start Run →</Link>}
      <style>{`
        .payroll-banner { margin:10px 0 0;background:var(--warnbg, #fffbeb);border:1px solid var(--warnbd, #fde68a);border-inline-start:4px solid var(--warn, #d97706);border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:10px; }
        .pb-icon { flex-shrink:0; }
        .pb-text { flex:1; }
        .pb-label { font-size:11px;font-weight:700;color:var(--warn, #92400e); }
        .pb-sub { font-size:11px;color:var(--ink,#0f172a);margin-top:1px; }
        .pb-btn { background:var(--warn, #92400e);color:var(--panel, #fff);border-radius:5px;font-size:11px;font-weight:700;padding:5px 12px;text-decoration:none;white-space:nowrap;flex-shrink:0; }
      `}</style>
    </div>
  );
}
