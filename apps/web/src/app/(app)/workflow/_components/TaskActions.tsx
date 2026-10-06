"use client";

/**
 * Workflow task maker-checker actions (client).
 *
 * Each control wraps the shared ActionButton/ConfirmDialog primitive so an
 * irreversible decision requires explicit confirmation. Reject/Return require a
 * typed reason (maker-checker). Actions POST the real proxied workflow-service
 * task endpoints and refresh the route on success; a polite aria-live region
 * announces the outcome (toast-equivalent, dependency-free + accessible).
 *
 * Endpoints (via /api/proxy → gateway → workflow-service):
 *   POST /v1/workflow/tasks/:id/complete   { decision: approve|reject|return }
 *   POST /v1/workflow/tasks/:id/claim
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, useToastOptional } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { UserFacingError } from "@/lib/userFacingError";

/**
 * Plain-language failure message for a failed workflow-task action. This is
 * a module-scope helper, not a component, so it can't use the useFormError
 * hook; toHumanError is the same catalogued-message building block that hook
 * is built on — never the backend's own `message`/`error` or the raw HTTP
 * status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function taskActionError(): string {
  const human = toHumanError("save", { area: "task" });
  return `${human.what} ${human.next}`;
}

async function postJson(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.ok || res.status === 202) return;
  // GAP-WORKFLOW-MY-TASKS-01 — map the workflow-service's specific
  // segregation-of-duties / assignment codes to plain messages so a blocked
  // action explains itself instead of showing the generic "couldn't save".
  // The server remains the authority; this only improves the message.
  let code: string | undefined;
  try {
    const data = (await res.json()) as { code?: unknown };
    if (typeof data.code === "string") code = data.code;
  } catch {
    /* non-JSON body — fall through to the generic message */
  }
  throw new UserFacingError(messageForCode(code, res.status));
}

/** Plain-language message for a known task-action failure code. */
function messageForCode(code: string | undefined, status: number): string {
  switch (code) {
    case "NOT_ASSIGNEE":
      return "This task is claimed by another reviewer. You can only act on tasks assigned to you.";
    case "ALREADY_CLAIMED":
      return "This task was just claimed by someone else. Refresh to see the current owner.";
    case "SELF_APPROVAL_DENIED":
      return "You submitted this request, so you can't approve it yourself (maker-checker).";
    case "SOD_REPEAT_ACTOR":
      return "You already acted on an earlier step of this workflow, so you can't act on this one.";
    case "ROLE_NOT_AUTHORIZED":
      return "You don't hold the role required to act on this task.";
    case "INSTANCE_NOT_ACTIVE":
      return "This workflow is suspended or cancelled, so its tasks can't be completed right now.";
    case "CONFLICT":
    case "CALL_TASK":
      return "This task can no longer be actioned. Refresh to see its current state.";
    default:
      return status === 403
        ? "You're not permitted to perform this action."
        : taskActionError();
  }
}

/**
 * GAP-WORKFLOW-INSTANCES-DETAIL-04 — prefer the GLOBAL ToastProvider (mounted
 * in (app)/layout.tsx) so an outcome announcement survives the decided row
 * unmounting on router.refresh() (the page filters to pending tasks, so the
 * row — and any row-local live region — disappears before a screen reader can
 * read it). When no provider is present (isolated unit test) fall back to a
 * local sr-only live region + banner so the message is still rendered.
 */
function useToast() {
  const dsToast = useToastOptional();
  const [local, setLocal] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const announce = useCallback(
    (kind: "ok" | "err", text: string) => {
      if (dsToast) {
        if (kind === "ok") dsToast.toast.success(text);
        else dsToast.toast.error(text);
      } else {
        setLocal({ kind, text });
      }
    },
    [dsToast],
  );
  const node = dsToast ? null : (
    <div aria-live="polite" role="status" className="sr-only">
      {local ? local.text : ""}
    </div>
  );
  const banner = dsToast || !local ? null : (
    <div className={`pill ${local.kind === "ok" ? "good" : "bad"}`} style={{ marginInlineStart: 8 }}>
      {local.text}
    </div>
  );
  return { announce, node, banner };
}

export interface TaskActionsProps {
  taskId: string;
  status: string;
  /** The task's current assignee id (null when unassigned/claimable). */
  assigneeId?: string | null;
  /** The signed-in user's id (JWT sub), for maker-checker UI hints. */
  currentUserId?: string | null;
  /** Compact rendering for table rows (omits the long descriptions). */
  compact?: boolean;
}

export function TaskActions({ taskId, status, assigneeId = null, currentUserId = null, compact = false }: TaskActionsProps) {
  const router = useRouter();
  const { announce, node, banner } = useToast();
  const isPending = (status ?? "").toLowerCase() === "pending";
  const [claiming, setClaiming] = useState(false);

  // GAP-WORKFLOW-MY-TASKS-01 — decision controls (Approve/Return/Reject) only
  // make sense once the task is yours. Show them when the task is assigned to
  // the signed-in user; when it is unassigned, offer Claim first; when it is
  // claimed by someone ELSE, hide the decision buttons entirely (the server
  // also enforces this with 403 NOT_ASSIGNEE — this is defence-in-depth + a
  // cleaner inbox, never the sole gate). If we don't know the current user id
  // (session not resolved), fall back to the previous behaviour of showing the
  // controls so we never hide a legitimately-actionable task.
  const unassigned = !assigneeId;
  const mineOrUnknown = currentUserId == null || assigneeId === currentUserId;
  const claimedByOther = !unassigned && currentUserId != null && assigneeId !== currentUserId;
  const canDecide = isPending && (unassigned ? false : mineOrUnknown);

  const complete = useCallback(
    async (decision: "approve" | "reject" | "return", reason?: string) => {
      await postJson(`/api/proxy/v1/workflow/tasks/${taskId}/complete`, {
        decision,
        ...(reason ? { reason } : {}),
      });
    },
    [taskId],
  );

  if (!isPending) {
    return (
      <span className="pill mut" role="status" aria-label={`Task ${status}`}>
        {status}
      </span>
    );
  }

  // GAP-WORKFLOW-MY-TASKS-01 — a task claimed by another reviewer offers no
  // actions here (no Claim: it's taken; no decisions: they're not the owner).
  if (claimedByOther) {
    return (
      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span className="pill mut" role="status">Claimed by another reviewer</span>
        {banner}
        {node}
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {unassigned && (
        // GAP-WORKFLOW-MY-TASKS-08 — Claim is a reversible-intent, low-risk
        // action; make it one click (a plain button + toast) rather than a
        // full ConfirmDialog. Decisions below keep their confirmations.
        <button
          type="button"
          className="btn ghost sm"
          disabled={claiming}
          onClick={async () => {
            setClaiming(true);
            try {
              await postJson(`/api/proxy/v1/workflow/tasks/${taskId}/claim`);
              announce("ok", "Task claimed.");
              router.refresh();
            } catch (err) {
              announce("err", err instanceof UserFacingError ? err.message : taskActionError());
            } finally {
              setClaiming(false);
            }
          }}
        >
          {claiming ? "Claiming…" : "Claim"}
        </button>
      )}
      {canDecide && (
        <>
          <ActionButton
            label="Approve"
            className="btn primary sm"
            confirmTitle="Approve this task?"
            confirmDescription={
              compact ? undefined : "Approval advances the workflow to the next step. The approving officer must be distinct from the maker (maker-checker). This decision is recorded in the transition history and cannot be undone."
            }
            confirmLabel="Approve"
            onConfirm={async () => {
              await complete("approve");
            }}
            onSuccess={() => {
              announce("ok", "Task approved.");
              router.refresh();
            }}
          />
          <ActionButton
            label="Return"
            className="btn ghost sm"
            confirmTitle="Return this task for rework?"
            confirmDescription={
              compact ? undefined : "Returning sends the item back to the previous step for correction. A reason is required and recorded in the transition history."
            }
            confirmLabel="Return"
            requireReason
            reasonLabel="Reason for return"
            onConfirm={async (reason) => {
              await complete("return", reason);
            }}
            onSuccess={() => {
              announce("ok", "Task returned for rework.");
              router.refresh();
            }}
          />
          <ActionButton
            label="Reject"
            className="btn ghost sm"
            danger
            confirmTitle="Reject this task?"
            confirmDescription={
              compact ? undefined : "Rejection terminates this branch of the workflow. A reason is required and recorded in the immutable transition history. This cannot be undone."
            }
            confirmLabel="Reject"
            requireReason
            reasonLabel="Reason for rejection"
            onConfirm={async (reason) => {
              await complete("reject", reason);
            }}
            onSuccess={() => {
              announce("err", "Task rejected.");
              router.refresh();
            }}
          />
        </>
      )}
      {banner}
      {node}
    </div>
  );
}
