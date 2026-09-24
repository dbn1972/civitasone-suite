import Link from "next/link";

export interface MyLeaveStatusItem {
  id: string;
  fromDate: string;
  toDate: string;
  days: number;
  status: string;
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: "var(--warnbg, #fffbeb)", color: "var(--warn, #d97706)", label: "Pending" },
  approved:  { bg: "var(--goodbg, #f0fdf4)", color: "var(--good, #16a34a)", label: "Approved" },
  rejected:  { bg: "var(--badbg, #fef2f2)", color: "var(--bad, #dc2626)", label: "Rejected" },
  cancelled: { bg: "var(--bg, #f1f5f9)", color: "var(--mut, #64748b)", label: "Cancelled" },
  // Distinct from `rejected` on purpose -- see LeaveHistoryClient.tsx's
  // identical distinction. This is a system routing failure, not a human
  // decision on the request.
  routing_failed: { bg: "var(--badbg, #fef2f2)", color: "var(--bad, #dc2626)", label: "Needs attention" },
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
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--mut, #64748b)" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <p>No leave applications yet</p>
        </div>
      ) : (
        items.map((item) => {
          const style = STATUS_STYLE[item.status] ?? { bg: "var(--bg, #f1f5f9)", color: "var(--mut, #64748b)", label: item.status };
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

      <style>{`
        .my-leave-panel { background: var(--panel,#fff); border-radius:8px; box-shadow:0 1px 3px rgba(15,34,64,.09); overflow:hidden; }
        .my-leave-head { padding:13px 16px 11px; border-bottom:1px solid var(--line,#e2e8f0); display:flex; align-items:center; justify-content:space-between; }
        .my-leave-title { font-size:12px; font-weight:700; display:flex; align-items:center; gap:7px; }
        .my-leave-dot { width:8px;height:8px;border-radius:50%;background:var(--info, #2563eb);flex-shrink:0; }
        .my-leave-link { font-size:11px; color:var(--info, #2563eb); font-weight:600; text-decoration:none; }
        .my-leave-empty { padding:28px 16px; text-align:center; color:var(--muted,#64748b); font-size:12px; display:flex; flex-direction:column; align-items:center; gap:8px; }
        .my-leave-item { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:12px 16px; border-bottom:1px solid var(--line,#e2e8f0); }
        .my-leave-item:last-child { border-bottom:none; }
        .my-leave-dates { font-size:13px; font-weight:600; color:var(--ink,#0f172a); }
        .my-leave-meta { font-size:11px; color:var(--muted,#64748b); margin-top:2px; }
        .my-leave-status-wrap { flex-shrink:0; text-align:end; }
        .my-leave-status { display:inline-flex; align-items:center; padding:2px 9px; border-radius:20px; font-size:10px; font-weight:600; white-space:nowrap; }
        .my-leave-explain { margin-top:4px; font-size:10px; color:var(--bad, #dc2626); max-width:140px; }
      `}</style>
    </div>
  );
}
