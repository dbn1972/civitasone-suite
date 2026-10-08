"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-NOTIFICATIONS-EXPERIMENTS-01: the maker-checker winner-promotion workflow
 * was invisible from the experiments list — the subtitle and legend promised an
 * "approve-winner" step but there was no control to action it, so a reviewer
 * could never clear the "Awaiting approval" count from this screen.
 *
 * This client component surfaces the two real service endpoints that already
 * exist and are role-gated server-side (requireRole(WRITE_ROLES)):
 *   - running/draft  -> POST /v1/notification/experiments/:id/conclude
 *                       (requestWinnerApproval → status pending_approval)
 *   - pending_approval -> POST /v1/notification/experiments/:id/approve-winner
 *                       (promotes the winner → concluded)
 * Both are gated behind an explicit ConfirmDialog (fail-closed, no accidental
 * promotion) and router.refresh() re-reads the list afterwards.
 *
 * SERVER AUTHZ NOTE (HUMAN REVIEW): the service enforces a write-role gate but
 * does NOT yet enforce maker≠checker separation (the person who requested
 * conclusion can also approve the winner), because the schema stores no
 * `conclusionRequestedBy`. That separation is recorded for human review rather
 * than silently faked in the UI; this component does not pretend to enforce it.
 */
type Action = "request" | "approve";

export function ExperimentActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const formError = useFormError("experiment");
  const [open, setOpen] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const canRequest = status === "running" || status === "draft";
  const canApprove = status === "pending_approval";
  if (!canRequest && !canApprove) {
    return <span className="muted" style={{ fontSize: 12 }}>—</span>;
  }

  async function run(action: Action) {
    setBusy(true);
    setError(undefined);
    formError.clear();
    const path = action === "request"
      ? `/api/proxy/v1/notification/experiments/${id}/conclude`
      : `/api/proxy/v1/notification/experiments/${id}/approve-winner`;
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setOpen(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canRequest ? (
        <Button variant="ghost" onClick={() => setOpen("request")}>Request winner approval</Button>
      ) : (
        <Button onClick={() => setOpen("approve")}>Approve winner</Button>
      )}
      <ConfirmDialog
        open={open === "request"}
        title="Request winner approval?"
        description="This freezes the analysis and moves the experiment to “Awaiting winner approval”. A separate reviewer then approves promotion of the winner."
        confirmLabel="Request approval"
        busy={busy}
        errorMessage={error}
        onConfirm={() => run("request")}
        onCancel={() => { if (!busy) setOpen(null); }}
      />
      <ConfirmDialog
        open={open === "approve"}
        title="Approve and promote the winner?"
        description="This promotes the proposed winning variant and concludes the experiment. This cannot be undone."
        confirmLabel="Approve winner"
        busy={busy}
        errorMessage={error}
        onConfirm={() => run("approve")}
        onCancel={() => { if (!busy) setOpen(null); }}
      />
    </>
  );
}
