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
import { ActionButton } from "@/app/_components/ds";

async function postJson(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!(res.ok || res.status === 202)) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status}).`;
    try {
      const j = JSON.parse(text);
      msg = j?.message ?? j?.error ?? msg;
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
}

/** Shared polite live-region for action outcomes. */
function useToast() {
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const announce = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
  }, []);
  const node = (
    <div aria-live="polite" role="status" className="sr-only">
      {toast ? toast.text : ""}
    </div>
  );
  const banner = toast ? (
    <div
      className={`pill ${toast.kind === "ok" ? "good" : "bad"}`}
      style={{ marginLeft: 8 }}
    >
      {toast.text}
    </div>
  ) : null;
  return { announce, node, banner };
}

export interface TaskActionsProps {
  taskId: string;
  status: string;
  /** Whether the task is currently unassigned (claimable). */
  assigned: boolean;
  /** Compact rendering for table rows (omits the long descriptions). */
  compact?: boolean;
}

export function TaskActions({ taskId, status, assigned, compact = false }: TaskActionsProps) {
  const router = useRouter();
  const { announce, node, banner } = useToast();
  const isPending = (status ?? "").toLowerCase() === "pending";

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
      <span className="pill mut" aria-label={`Task ${status}`}>
        {status}
      </span>
    );
  }

  return (
    <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {!assigned && (
        <ActionButton
          label="Claim"
          className="btn ghost sm"
          confirmTitle="Claim this task?"
          confirmDescription={
            compact ? undefined : "Claiming assigns this task to you so you can act on it. A claimed task is removed from other reviewers' inboxes."
          }
          confirmLabel="Claim task"
          onConfirm={async () => {
            await postJson(`/api/proxy/v1/workflow/tasks/${taskId}/claim`);
          }}
          onSuccess={() => {
            announce("ok", "Task claimed.");
            router.refresh();
          }}
        />
      )}
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
      {banner}
      {node}
    </div>
  );
}
