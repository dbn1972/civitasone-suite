"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

/**
 * Maker-checker decide control shared by the revenue approval screens
 * (instalment plans, recovery referrals, rate-config proposals).
 *
 * The officer who RAISED the item may not decide it (separation of duties) — the
 * control is disabled for them with an explanation; the server is the authority
 * and rejects a same-user decision regardless (409 MAKER_CHECKER_VIOLATION).
 * A decided item shows its status and no live buttons.
 */
export function DecideActions({
  decideUrl,
  noun,
  status,
  makerUserId,
  currentUserId,
  summary,
}: {
  /** PATCH path (relative to the API proxy), e.g. v1/revenue/instalments/:id/decide. */
  decideUrl: string;
  /** What is being decided, lower-case: "instalment plan". */
  noun: string;
  status: string;
  makerUserId?: string | null;
  /** Signed-in user id (JWT sub), for the maker != checker UI hint. */
  currentUserId?: string | null;
  /** Human description of the item for the confirm dialog. */
  summary: ReactNode;
}) {
  const router = useRouter();
  const [pendingApprove, setPendingApprove] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [decidedLocally, setDecidedLocally] = useState(false);

  const isPending = status === "pending";
  const isMaker = !!currentUserId && !!makerUserId && currentUserId === makerUserId;
  const canDecide = isPending && !isMaker && !decidedLocally;

  function start(approve: boolean) {
    if (!canDecide) return;
    setPendingApprove(approve);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit(reason?: string) {
    if (pendingApprove === null || !canDecide) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson(decideUrl, {
        method: "PATCH",
        body: JSON.stringify({ approve: pendingApprove, reason: reason?.trim() || undefined }),
      });
      setConfirmOpen(false);
      setMessage(`Decision submitted (${pendingApprove ? "approve" : "reject"}). It is processed asynchronously.`);
      setPendingApprove(null);
      setDecidedLocally(true);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!isPending || decidedLocally) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          Already decided — no further action is available. <StatusPill status={status} label={status} />
        </p>
        {message && (
          <p role="status" className="pill good" style={{ width: "fit-content" }}>
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {isMaker && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
          You raised this {noun}, so a different officer must decide it.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button type="button" style={{ minHeight: 44, minWidth: 120 }} aria-label={`Approve ${noun}`} disabled={!canDecide} onClick={() => start(true)}>
          Approve
        </Button>
        <Button type="button" variant="danger" style={{ minHeight: 44, minWidth: 120 }} aria-label={`Reject ${noun}`} disabled={!canDecide} onClick={() => start(false)}>
          Reject
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={pendingApprove ? `Approve this ${noun}?` : `Reject this ${noun}?`}
        confirmLabel={pendingApprove ? `Approve ${noun}` : `Reject ${noun}`}
        danger={pendingApprove === false}
        requireReason={pendingApprove === false}
        reasonLabel={pendingApprove === false ? "Reason for rejection" : "Reason (optional)"}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            {pendingApprove ? "Approving" : "Rejecting"} {summary}. The deciding officer must be different from the
            officer who raised it; the server rejects same-user decisions.
          </>
        }
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => {
          if (!busy) {
            setConfirmOpen(false);
            setPendingApprove(null);
            setDialogError(undefined);
          }
        }}
      />
    </div>
  );
}
