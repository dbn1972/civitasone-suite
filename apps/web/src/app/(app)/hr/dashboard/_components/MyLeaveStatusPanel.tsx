import Link from "next/link";

export interface MyLeaveStatusItem {
  id: string;
  fromDate: string;
  toDate: string;
  days: number;
  status: string;
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: "var(--warnbg)", color: "var(--warn)", label: "Pending" },
  approved:  { bg: "var(--goodbg)", color: "var(--good)", label: "Approved" },
  rejected:  { bg: "var(--badbg)", color: "var(--bad)", label: "Rejected" },
  cancelled: { bg: "var(--bg)", color: "var(--mut)", label: "Cancelled" },
  // Distinct from `rejected` on purpose -- see LeaveHistoryClient.tsx's
  // identical distinction. This is a system routing failure, not a human
  // decision on the request.
  routing_failed: { bg: "var(--badbg)", color: "var(--bad)", label: "Needs attention" },
};

function fmt(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/**
 * Employee-role counterpart to ActionInbox.tsx: read-only, shows THIS
 * employee's own recent leave applications instead of an HR admin's
 * approve/reject queue for everyone else's. Kept as a separate component
 * rather than an ActionInbox "mode" prop so ActionInbox's existing
 * approve/reject behaviour and tests stay completely untouched — see
 * hr/dashboard/page.tsx, which renders exactly one of the two per request.
 */
export function MyLeaveStatusPanel({ items }: { items: MyLeaveStatusItem[] }) {
  return (
    <div className="my-leave-panel">
      <div className="my-leave-head">
        <span className="my-leave-title">
          <span className="my-leave-dot" />
          My Leave Applications
        </span>
        <Link href="/hr/leave/history" className="my-leave-link">View all →</Link>
      </div>

      {items.length === 0 ? (
        <div className="my-leave-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--mut)" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <p>No leave applications yet</p>
        </div>
      ) : (
        items.map((item) => {
          const style = STATUS_STYLE[item.status] ?? { bg: "var(--bg)", color: "var(--mut)", label: item.status };
          return (
            <div key={item.id} className="my-leave-item">
              <div className="my-leave-info">
                <div className="my-leave-dates">{fmt(item.fromDate)} – {fmt(item.toDate)}</div>
                <div className="my-leave-meta">{item.days} day{item.days !== 1 ? "s" : ""}</div>
              </div>
              <div className="my-leave-status-wrap">
                <span className="my-leave-status" style={{ background: style.bg, color: style.color }}>{style.label}</span>
                {item.status === "routing_failed" && (
                  <div role="alert" className="my-leave-explain">Could not be routed — contact admin</div>
                )}
              </div>
            </div>
          );
        })
      )}

    </div>
  );
}
