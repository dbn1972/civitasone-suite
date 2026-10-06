"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { WriteOffRecord } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

// GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-03: the status a write-off must be in to
// still be decidable. Shared literal (revenue-service arrears schema defaults
// status to "pending"; approved/rejected are terminal). Kept in one place so a
// future refund/write-off alignment changes it once.
const PENDING_STATUS = "pending";

export function WriteOffDecideForm({
  writeOffId,
  writeOff,
  currentUserId,
  assesseeName,
}: {
  writeOffId: string;
  writeOff: WriteOffRecord | null;
  /** Signed-in user id (JWT sub), for the maker != checker UI hint. */
  currentUserId?: string | null;
  /** Resolved assessee name for the confirm dialog (falls back to short id). */
  assesseeName?: string | null;
}) {
  const router = useRouter();
  const [pendingApprove, setPendingApprove] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-03: once a decision succeeds, hide the
  // buttons immediately (router.refresh re-fetches, but this is instant).
  const [decidedLocally, setDecidedLocally] = useState(false);

  const shortId = writeOffId.slice(0, 8);

  // GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-01: the maker of an irreversible
  // balance reduction must not be able to approve/reject their own write-off.
  // The server remains the authority (same-user decisions are rejected
  // server-side); this disables the control so the maker never even opens the
  // dialog. Compared only when both ids are present.
  const isMaker =
    !!currentUserId && !!writeOff?.makerUserId && currentUserId === writeOff.makerUserId;

  // GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-03: an already-decided write-off keeps
  // no live Approve/Reject.
  const isPending = writeOff?.status === PENDING_STATUS;

  // Fail closed: never decide a write-off we couldn't load (CRITICAL-1), one we
  // raised ourselves (DECIDE-01), or one already decided (DECIDE-03).
  const canDecide = writeOff !== null && isPending && !isMaker && !decidedLocally;

  function startDecide(approve: boolean) {
    if (!canDecide) return;
    setPendingApprove(approve);
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitDecide(reason?: string) {
    if (pendingApprove === null || !canDecide) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>(`v1/revenue/write-offs/${writeOffId}/decide`, {
        method: "PATCH",
        body: JSON.stringify({
          approve: pendingApprove,
          reason: reason?.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        `Decision submitted (${pendingApprove ? "approve" : "reject"}${res.id ? `, id ${res.id}` : ""}). It is` +
          " processed asynchronously; the server rejects it if you are the same officer who raised the write-off.",
      );
      setPendingApprove(null);
      setDecidedLocally(true);
      router.refresh();
    } catch (err) {
      setTone("bad");
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Already-decided (or locally just-decided): show status, no live buttons.
  if (writeOff !== null && (!isPending || decidedLocally)) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          Already decided — no further action is available.{" "}
          <StatusPill status={writeOff.status} label={writeOff.status} />
        </p>
        {message && (
          <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
            {message}
          </p>
        )}
      </div>
    );
  }

  const assesseeLabel = assesseeName ?? (writeOff ? writeOff.assesseeId.slice(0, 8) : "");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!canDecide && writeOff === null && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
          Approve/Reject are disabled until the write-off record loads successfully.
        </p>
      )}

      {isMaker && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
          You raised this write-off, so a different officer must decide it.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          type="button"
          style={{ minHeight: 44, minWidth: 120 }}
          aria-label={`Approve write-off ${shortId}`}
          disabled={!canDecide}
          onClick={() => startDecide(true)}
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="danger"
          style={{ minHeight: 44, minWidth: 120 }}
          aria-label={`Reject write-off ${shortId}`}
          disabled={!canDecide}
          onClick={() => startDecide(false)}
        >
          Reject
        </Button>
      </div>

      {message && (
        <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={pendingApprove ? "Approve this write-off?" : "Reject this write-off?"}
        confirmLabel={pendingApprove ? "Approve write-off" : "Reject write-off"}
        danger={pendingApprove === false}
        requireReason={pendingApprove === false}
        reasonLabel={pendingApprove === false ? "Reason for rejection" : "Reason (optional)"}
        busy={busy}
        errorMessage={dialogError}
        description={
          writeOff ? (
            <>
              {pendingApprove ? "Approving" : "Rejecting"} a write-off of{" "}
              <strong>{formatMoney(writeOff.amountMinor)}</strong> for assessee{" "}
              <strong>{assesseeLabel}</strong> — reason on file:{" "}
              <em>&ldquo;{writeOff.reason || "—"}&rdquo;</em>. This permanently reduces the demand balance once
              approved — the deciding officer must be different from the officer who raised the write-off; the
              server rejects same-user maker-checker decisions.
            </>
          ) : (
            "Write-off details are unavailable."
          )
        }
        onConfirm={(reason) => void submitDecide(reason)}
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
