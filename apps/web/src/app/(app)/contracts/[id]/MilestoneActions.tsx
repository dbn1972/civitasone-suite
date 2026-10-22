"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AcceptedNotice, ActionButton } from "../../../_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDate, todayIST } from "@/lib/formatters";

export type ContractMilestone = {
  id: string;
  title: string;
  status: string;
  dueDate?: string;
};

type Props = { contractId: string; milestones: ContractMilestone[] };

// GAP-CONTRACTS-DETAIL-06: intervals (ms) for the post-202 refresh polls.
// The consumer typically writes the new status within a few seconds; three
// attempts (immediate, 5 s, 10 s) cover the P99 queue latency without
// hammering the server.

export function MilestoneActions({ contractId, milestones }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const accepted = useAcceptedWrite();
  const formError = useFormError("milestone");

  // GAP-CONTRACTS-DETAIL-06: track which milestone ids have a write in flight
  // (202 accepted but consumer not yet reflected). Key = id, value = the
  // status the milestone had *before* the action, so we can detect when the
  // server-rendered data catches up and clear the pill automatically.
  const [pendingMap, setPendingMap] = useState<Map<string, string>>(new Map());


  // When `milestones` props change (i.e. after router.refresh() propagates),
  // clear any pending entries whose status has changed from what it was before
  // the action.
  useEffect(() => {
    setPendingMap((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [id, prevStatus] of next) {
        const current = milestones.find((m) => m.id === id);
        if (!current || current.status !== prevStatus) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [milestones]);


  // The "received" notice is moot once every pending change has landed in props.
  useEffect(() => {
    if (pendingMap.size === 0 && accepted.phase === "accepted") accepted.reset();
  }, [pendingMap, accepted]);

  const actionable = milestones.filter(
    (m) => m.status !== "completed" && m.status !== "completed_late",
  );

  async function act(milestoneId: string, kind: "complete" | "late", notes?: string) {
    setBusyId(milestoneId);
    setMessage("");
    accepted.reset();
    try {
      const today = todayIST();
      const res = await fetch(
        `/api/proxy/v1/contract/contracts/${contractId}/milestones/${milestoneId}/${kind}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "late"
              ? { achievedDate: today, notes: notes?.trim() || "Marked late from contract detail" }
              : { achievedDate: today },
          ),
        },
      );
      if (res.status !== 202 && !res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      // GAP-CONTRACTS-DETAIL-06: mark the row Pending and schedule polls.
      // "Request received" copy never claims the action completed — the
      // consumer may still be processing.
      const prevStatus = milestones.find((m) => m.id === milestoneId)?.status ?? "";
      setPendingMap((prev) => new Map(prev).set(milestoneId, prevStatus));
      setMessage(
        kind === "late"
          ? "Late-milestone request received — the status will update shortly."
          : "Completion request received — the status will update shortly.",
      );
      // Immediate first refresh; schedule two more at 5 s and 10 s.
      router.refresh();
      // SF-15: no timer-based refresh. 202 = received; the Refresh button (AcceptedNotice) re-reads on demand.
      accepted.accept();
    } finally {
      setBusyId(null);
    }
  }

  if (actionable.length === 0 && !message) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {actionable.map((m) => (
        <div key={m.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, flex: 1 }}>
            {m.title}
            {/* GAP-CONTRACTS-DETAIL-05: show the due date next to each action
                row so "Complete"/"Mark late" is never decided blind. */}
            {m.dueDate ? (
              <span style={{ color: "var(--ink2)" }}> · due {formatIndianDate(m.dueDate)}</span>
            ) : null}
          </span>
          {/* GAP-CONTRACTS-DETAIL-06: Pending pill while the 202 write propagates. */}
          {pendingMap.has(m.id) ? (
            <span className="pill mut" aria-label="Status update pending">Pending</span>
          ) : null}
          <ActionButton
            className="btn ghost"
            label="Complete"
            disabled={busyId === m.id}
            confirmTitle={`Mark "${m.title}" complete?`}
            confirmDescription="Records this milestone as delivered on time. This cannot be undone."
            confirmLabel="Yes, mark complete"
            onConfirm={() => act(m.id, "complete")}
          />
          <ActionButton
            // Unlike Complete, leave className unset here so ActionButton's
            // own default ("btn danger") applies -- this is the button that
            // applies a real SLA penalty and should look visibly different
            // from the harmless "Complete" button, not identical to it.
            label="Mark late"
            disabled={busyId === m.id}
            confirmTitle={`Mark "${m.title}" as delivered late?`}
            confirmDescription={`${m.dueDate ? `Due ${formatIndianDate(m.dueDate)}. ` : ""}Applies the contract's SLA delay penalty and reduces the net payable amount. This cannot be undone.`}
            confirmLabel="Yes, mark late"
            danger
            requireReason
            reasonLabel="Reason for the delay (recorded on the milestone)"
            // markMilestoneLateBody caps notes at 500 chars server-side.
            maxReasonLength={500}
            onConfirm={(notes) => act(m.id, "late", notes)}
          />
        </div>
      ))}
      {accepted.phase !== "idle" ? (
        <AcceptedNotice {...accepted.noticeProps} message={message} />
      ) : message ? (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
