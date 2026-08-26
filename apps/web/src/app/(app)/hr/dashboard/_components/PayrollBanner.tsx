import Link from "next/link";

interface Props { daysLeft: number; monthName: string; headcount: number }

export function PayrollBanner({ daysLeft, monthName, headcount }: Props) {
  return (
    <div className="payroll-banner" role="alert" aria-label="Payroll deadline notice">
      <div className="pb-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
      </div>
      <div className="pb-text">
        <div className="pb-label">Payroll Processing</div>
        <div className="pb-sub">{monthName} cycle · {headcount.toLocaleString("en-IN")} employees · Deadline in {daysLeft} day{daysLeft !== 1 ? "s" : ""}</div>
      </div>
      <Link href="/hr/payroll" className="pb-btn">Start Run →</Link>
      <style>{`
        .payroll-banner { margin:10px 0 0;background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:10px; }
        .pb-icon { flex-shrink:0; }
        .pb-text { flex:1; }
        .pb-label { font-size:11px;font-weight:700;color:#92400e; }
        .pb-sub { font-size:11px;color:var(--text,#0f172a);margin-top:1px; }
        .pb-btn { background:#92400e;color:#fff;border-radius:5px;font-size:11px;font-weight:700;padding:5px 12px;text-decoration:none;white-space:nowrap;flex-shrink:0; }
      `}</style>
    </div>
  );
}
