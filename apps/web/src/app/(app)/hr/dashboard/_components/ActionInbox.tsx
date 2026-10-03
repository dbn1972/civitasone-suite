"use client";
import { UserFacingError } from "@/lib/userFacingError";
import { useState } from "react";
import Link from "next/link";
import type { LeaveInboxItem } from "@civitasone/types";
import { useFormError } from "@/lib/useFormError";
import { ConfirmDialog, useConfirmAction } from "@/app/_components/ds";

const LEAVE_COLORS: Record<string, { bg: string; color: string }> = {
  EL:  { bg: "var(--infobg, #eff6ff)", color: "var(--info, #2563eb)" },
  CL:  { bg: "var(--warnbg, #fffbeb)", color: "var(--warn, #d97706)" },
  ML:  { bg: "var(--badbg, #fef2f2)", color: "var(--bad, #dc2626)" },
  HPL: { bg: "var(--badbg, #fef2f2)", color: "var(--bad, #dc2626)" },
  PL:  { bg: "var(--goodbg, #f0fdf4)", color: "var(--good, #16a34a)" },
  CCL: { bg: "var(--primary-soft, #fdf4ff)", color: "var(--violet, #9333ea)" },
};

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}
// GAP-HR-DASHBOARD-09: wrapped in var(--token, #same-fallback) instead of
// bare hex -- no token is defined anywhere, so every fallback renders
// identically to before this change.
const AVATAR_BG = ["var(--dash-avatar-bg-1, #dbeafe)", "var(--dash-avatar-bg-2, #fce7f3)", "var(--dash-avatar-bg-3, #d1fae5)", "var(--dash-avatar-bg-4, #fef3c7)", "var(--dash-avatar-bg-5, #e0e7ff)", "var(--dash-avatar-bg-6, #fee2e2)"];
const AVATAR_FG = ["var(--dash-avatar-fg-1, #1e40af)", "var(--dash-avatar-fg-2, #9d174d)", "var(--dash-avatar-fg-3, #065f46)", "var(--dash-avatar-fg-4, #92400e)", "var(--dash-avatar-fg-5, #3730a3)", "var(--dash-avatar-fg-6, #991b1b)"];

interface Props {
  initialItems: LeaveInboxItem[];
  /**
   * hr_admin/hr_officer/super_admin only (page.tsx's canManageEmployees).
   * This inbox also renders for a "manager" viewer (HR_DASHBOARD_READER_ROLES
   * includes it), but the backend 403s WORKFLOW_REQUIRED for approve/reject
   * unless the caller holds one of HR_ROLES (leave/routes.ts) -- so a
   * manager gets a link into the real approvals/workflow queue instead of
   * buttons that would always fail.
   */
  canDecide: boolean;
}

/**
 * Parses the {code,message} error envelope every service's HttpError-backed
 * handler sends (see apiClient.ts's readErrorBody for the server-side
 * sibling of this same parse) -- duplicated locally rather than imported,
 * since apiClient.ts pulls in next/headers (server-only) and this is a
 * "use client" component. Never throws.
 */
async function parseErrorEnvelope(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await res.clone().json()) as { code?: unknown; message?: unknown };
    return {
      code: typeof body?.code === "string" ? body.code : undefined,
      message: typeof body?.message === "string" ? body.message : undefined,
    };
  } catch {
    return {};
  }
}

export function ActionInbox({ initialItems, canDecide }: Props) {
  const [items, setItems] = useState<LeaveInboxItem[]>(initialItems);
  const formError = useFormError("leave application");

  /**
   * Throws a clerk-safe Error on failure. useConfirmAction's own catch (see
   * ds/ActionButton.tsx) surfaces that message inside the still-open
   * ConfirmDialog and re-enables Confirm -- so a failed approve/decline
   * never removes the row or the buttons, and retrying is just clicking
   * Confirm again (GAP-HR-DASHBOARD-01).
   */
  async function decide(id: string, action: "approve" | "reject", reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/hrms/leave-applications/${id}/${action}`, {
      method: "PATCH",
      ...(reason !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }
        : {}),
    });
    if (res.ok) return;
    const { code, message } = await parseErrorEnvelope(res);
    // SELF_APPROVAL_FORBIDDEN's backend message (leave/routes.ts's
    // HttpError) is already a specific, clerk-safe sentence -- surfaced
    // verbatim, since useFormError's CODE_TO_KIND has no entry for this code
    // and would otherwise fall back to a generic "couldn't save" message
    // that drops this actionable detail on the floor.
    if (code === "SELF_APPROVAL_FORBIDDEN" && message) {
      throw new Error(message);
    }
    const resolved = await formError.fromResponse(res, "save");
    throw UserFacingError.from(resolved);
  }

  return (
    <div className="inbox-panel">
      <div className="inbox-head">
        <span className="inbox-title">
          <span className="inbox-dot" />
          Action Required — Leave Approvals
        </span>
        <Link href="/hr/leave/approvals" className="inbox-link">Manage all →</Link>
      </div>

      {items.length === 0 ? (
        <div className="inbox-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--good, #16a34a)" strokeWidth="1.5" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <p>Inbox clear — no pending approvals</p>
        </div>
      ) : (
        items.map((item, idx) => {
          const codeKey = item.leaveTypeCode.toUpperCase();
          const tag = LEAVE_COLORS[codeKey] ?? { bg: "var(--bg, #f1f5f9)", color: "var(--mut, #64748b)" };
          const bi = idx % AVATAR_BG.length;
          return (
            <InboxRow
              key={item.id}
              item={item}
              tag={tag}
              avatarBg={AVATAR_BG[bi]!}
              avatarFg={AVATAR_FG[bi]!}
              canDecide={canDecide}
              onApprove={() => decide(item.id, "approve")}
              onDecline={(reason) => decide(item.id, "reject", reason)}
              onDecided={() => setItems((p) => p.filter((i) => i.id !== item.id))}
            />
          );
        })
      )}

      <style>{`
        .inbox-panel { background: var(--panel,#fff); border-radius:8px; box-shadow:0 1px 3px rgba(15,34,64,.09); overflow:hidden; }
        .inbox-head { padding:13px 16px 11px; border-bottom:1px solid var(--line,#e2e8f0); display:flex; align-items:center; justify-content:space-between; }
        .inbox-title { font-size:12px; font-weight:700; display:flex; align-items:center; gap:7px; }
        .inbox-dot { width:8px;height:8px;border-radius:50%;background:var(--bad, #dc2626);flex-shrink:0; }
        .inbox-link { font-size:11px; color:var(--info, #2563eb); font-weight:600; text-decoration:none; }
        .inbox-empty { padding:28px 16px; text-align:center; color:var(--muted,#64748b); font-size:12px; display:flex; flex-direction:column; align-items:center; gap:8px; }
        .inbox-item { display:grid; grid-template-columns:36px 1fr auto; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--line,#e2e8f0); }
        .inbox-item:last-child { border-bottom:none; }
        .inbox-avatar { width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0; }
        .inbox-name { font-size:13px;font-weight:600;color:var(--ink,#0f172a); }
        .inbox-meta { font-size:11px;color:var(--muted,#64748b);margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap; }
        .leave-tag { display:inline-flex;align-items:center;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:600; }
        .inbox-actions { display:flex;gap:5px;flex-shrink:0;align-items:center; }
        .btn-approve { background:var(--goodbg,#f0fdf4);color:var(--good,#16a34a);border:1px solid var(--goodbd,#bbf7d0);border-radius:5px;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer; }
        .btn-approve:disabled { opacity:.5;cursor:not-allowed; }
        .btn-decline { background:var(--badbg,#fef2f2);color:var(--bad,#dc2626);border:1px solid var(--badbd,#fecaca);border-radius:5px;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer; }
        .btn-decline:disabled { opacity:.5;cursor:not-allowed; }
        .inbox-link-approvals { font-size:11px;color:var(--info, #2563eb);font-weight:600;text-decoration:none;white-space:nowrap; }
        .inbox-confirm-summary p { margin:0 0 6px; font-size:13px; }
        .inbox-confirm-summary p:last-child { margin-bottom:0; }
      `}</style>
    </div>
  );
}

function InboxRow({
  item, tag, avatarBg, avatarFg, canDecide, onApprove, onDecline, onDecided,
}: {
  item: LeaveInboxItem;
  tag: { bg: string; color: string };
  avatarBg: string;
  avatarFg: string;
  canDecide: boolean;
  onApprove: () => Promise<void>;
  onDecline: (reason?: string) => Promise<void>;
  onDecided: () => void;
}) {
  const approve = useConfirmAction({ onConfirm: onApprove, onSuccess: onDecided });
  const decline = useConfirmAction({ onConfirm: onDecline, onSuccess: onDecided });

  // GAP-HR-DASHBOARD-01: employee/dates/days/department shown in the
  // dialog, with a link into the real approvals queue for balance/overlap
  // context this compact inbox row doesn't have room to show inline.
  const summary = (
    <div className="inbox-confirm-summary">
      <p><strong>{item.employeeName}</strong> · {item.departmentName}</p>
      <p>{item.leaveTypeName} · {item.fromDate} – {item.toDate} · {item.daysApplied} day{item.daysApplied !== 1 ? "s" : ""}</p>
      <p><Link href="/hr/leave/approvals">View balance &amp; overlap details →</Link></p>
    </div>
  );

  return (
    <div className="inbox-item">
      <div className="inbox-avatar" style={{ background: avatarBg, color: avatarFg }}>
        {initials(item.employeeName)}
      </div>
      <div className="inbox-info">
        <div className="inbox-name">{item.employeeName}</div>
        <div className="inbox-meta">
          <span className="leave-tag" style={{ background: tag.bg, color: tag.color }}>
            {item.leaveTypeName}
          </span>
          {item.fromDate} – {item.toDate} · {item.daysApplied} day{item.daysApplied !== 1 ? "s" : ""} · {item.departmentName}
        </div>
      </div>
      <div className="inbox-actions">
        {canDecide ? (
          <>
            <button
              className="btn-approve"
              onClick={approve.trigger}
              aria-label={`Approve leave for ${item.employeeName}`}
            >✓ Approve</button>
            <button
              className="btn-decline"
              onClick={decline.trigger}
              aria-label={`Decline leave for ${item.employeeName}`}
            >✕</button>
          </>
        ) : (
          <Link href="/hr/leave/approvals" className="inbox-link-approvals">Open in Approvals →</Link>
        )}
      </div>

      <ConfirmDialog
        open={approve.open}
        title="Approve this leave request?"
        description={summary}
        confirmLabel="Yes, approve"
        busy={approve.busy}
        errorMessage={approve.error}
        onConfirm={() => { void approve.confirm(); }}
        onCancel={approve.cancel}
      />
      <ConfirmDialog
        open={decline.open}
        title="Decline this leave request?"
        description={summary}
        confirmLabel="Yes, decline"
        danger
        requireReason
        reasonLabel="Reason for declining"
        busy={decline.busy}
        errorMessage={decline.error}
        onConfirm={(reason) => { void decline.confirm(reason); }}
        onCancel={decline.cancel}
      />
    </div>
  );
}
