"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney, humanizeStatus } from "@/lib/formatters";
import type { WaiverRecord } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

const PENDING_STATUS = "pending";

export function WaiverDecideForm({
  waiverId,
  waiver,
  currentUserId,
}: {
  waiverId: string;
  waiver: WaiverRecord | null;
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const [pendingApprove, setPendingApprove] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [decidedLocally, setDecidedLocally] = useState(false);

  const shortId = waiverId.slice(0, 8);

  // GAP-REVENUE-WAIVERS-03: the maker must not decide their own waiver. Server
  // is the authority (decide consumer rejects same-officer decisions); this
  // disables the control so the maker never opens the dialog.
  const isMaker =
    !!currentUserId && !!waiver?.requestedBy && currentUserId === waiver.requestedBy;
  const isPending = waiver?.status === PENDING_STATUS;
  const canDecide = waiver !== null && isPending && !isMaker && !decidedLocally;

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
      const res = await browserJson<AcceptedResponse>(`v1/revenue/waivers/${waiverId}/decide`, {
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
          " processed asynchronously; the server rejects it if you are the same officer who raised the waiver.",
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

  if (waiver !== null && (!isPending || decidedLocally)) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          Already decided — no further action is available.{" "}
          <StatusPill status={waiver.status} label={humanizeStatus(waiver.status)} />
        </p>
        {message && (
          <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {waiver === null && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
          Approve/Reject are disabled until the waiver record loads successfully.
        </p>
      )}

      {isMaker && (
        <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
          You raised this waiver, so a different officer must decide it.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button
          type="button"
          style={{ minHeight: 44, minWidth: 120 }}
          aria-label={`Approve waiver ${shortId}`}
          disabled={!canDecide}
          onClick={() => startDecide(true)}
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="danger"
          style={{ minHeight: 44, minWidth: 120 }}
          aria-label={`Reject waiver ${shortId}`}
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
        title={pendingApprove ? "Approve this waiver?" : "Reject this waiver?"}
        confirmLabel={pendingApprove ? "Approve waiver" : "Reject waiver"}
        danger={pendingApprove === false}
        requireReason={pendingApprove === false}
        reasonLabel={pendingApprove === false ? "Reason for rejection" : "Reason (optional)"}
        busy={busy}
        errorMessage={dialogError}
        description={
          waiver ? (
            <>
              {pendingApprove ? "Approving" : "Rejecting"} a waiver of{" "}
              <strong>{formatMoney(waiver.amountMinor)}</strong> — reason on file:{" "}
              <em>&ldquo;{waiver.reason || "—"}&rdquo;</em>. A waiver remits penalty/interest, not the principal;
              the deciding officer must be different from the officer who raised it — the server rejects same-user
              maker-checker decisions.
            </>
          ) : (
            "Waiver details are unavailable."
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
