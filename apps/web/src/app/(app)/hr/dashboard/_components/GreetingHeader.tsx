import Link from "next/link";

interface Props {
  userName: string;
  pendingCount: number;
  payrollDaysLeft: number;
  today: string;   // pre-formatted server-side to avoid hydration mismatch
  dayName: string;
}

export function GreetingHeader({ userName, pendingCount, payrollDaysLeft, today, dayName }: Props) {
  const briefing =
    pendingCount > 0
      ? `${pendingCount} item${pendingCount > 1 ? "s" : ""} need${pendingCount === 1 ? "s" : ""} your attention`
      : payrollDaysLeft <= 7
      ? `Payroll closes in ${payrollDaysLeft} day${payrollDaysLeft !== 1 ? "s" : ""}`
      : "No urgent actions today";

  return (
    <div className="greeting-header" aria-label="Dashboard greeting">
      <div className="greeting-inner">
        <div className="greeting-text">
          <p className="greeting-eyebrow">HR & Payroll · People Operations</p>
          <h1 className="greeting-title">
            {dayName.startsWith("S") ? "Good day" : "Good morning"}, {userName}
          </h1>
          <p className="greeting-sub">
            {dayName}, {today} · {briefing}
          </p>
        </div>
        <div className="greeting-actions">
          <Link href="/hr/payroll" className="btn-ghost-nav">Export Report</Link>
          <Link href="/hr/employees/new" className="btn-primary-nav">+ Add Employee</Link>
        </div>
      </div>
      <style>{`
        .greeting-header {
          background: linear-gradient(108deg, #0f2240 0%, #1a3a6b 60%, #2554a0 100%);
          padding: 20px 28px 0;
          position: relative;
          overflow: hidden;
        }
        .greeting-header::after {
          content: '';
          display: block;
          height: 18px;
          background: var(--page-bg, #eef2f7);
          clip-path: ellipse(54% 100% at 50% 100%);
          margin: 0 -28px;
        }
        .greeting-inner {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding-bottom: 14px;
          flex-wrap: wrap;
        }
        .greeting-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: #6ea3f5;
          margin: 0 0 4px;
        }
        .greeting-title {
          font-size: 20px;
          font-weight: 700;
          color: #f0f6ff;
          letter-spacing: -.02em;
          margin: 0 0 3px;
        }
        .greeting-sub {
          font-size: 12px;
          color: #7ea8d8;
          margin: 0;
        }
        .greeting-actions {
          display: flex;
          gap: 8px;
          align-items: center;
          padding-top: 4px;
          flex-shrink: 0;
        }
        .btn-ghost-nav {
          background: rgba(255,255,255,.12);
          color: #c8daf5;
          border: 1px solid rgba(255,255,255,.15);
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          padding: 7px 14px;
          text-decoration: none;
          white-space: nowrap;
        }
        .btn-primary-nav {
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          padding: 7px 14px;
          text-decoration: none;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
