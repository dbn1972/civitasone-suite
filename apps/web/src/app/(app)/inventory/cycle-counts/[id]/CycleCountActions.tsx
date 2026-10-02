"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/app/_components/ds";
import { decisionFailure } from "@/lib/decisionError";

/**
 * Supervisor approve/reject for a cycle count that is pending_approval (its
 * variance exceeded the auto-adjust threshold). Both actions are maker-checker
 * gated behind a ConfirmDialog and post the current `version` for optimistic
 * locking — the consumer only applies the transition when the version matches.
 */
export function CycleCountActions({ cycleCountId, version }: { cycleCountId: string; version: number }) {
  const router = useRouter();

  // GAP-INVENTORY-CYCLE-COUNTS-DETAIL-04: never surface the raw response body. A
  // 409 means someone else decided first, so refresh to show the new status; the
  // `version` we sent for optimistic locking is untouched.
  async function fail(res: Response): Promise<never> {
    const failure = await decisionFailure(res, "cycle count");
    if (failure.stale) router.refresh();
    throw new Error(failure.message);
  }

  async function approve(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/inventory/cycle-counts/${cycleCountId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    });
    if (!res.ok) await fail(res);
  }

  async function reject(reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/inventory/cycle-counts/${cycleCountId}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, reason }),
    });
    if (!res.ok) await fail(res);
  }

  return (
    <>
      <ActionButton
        label="Approve"
        confirmTitle="Approve this cycle count?"
        confirmDescription="This posts the stock adjustment for the counted variance. This cannot be undone."
        confirmLabel="Approve"
        onConfirm={approve}
        onSuccess={() => router.refresh()}
      />
      <ActionButton
        label="Reject"
        danger
        requireReason
        reasonLabel="Reason for rejection"
        confirmTitle="Reject this cycle count?"
        confirmDescription="The count will be discarded and no stock adjustment will be posted. A reason is required."
        confirmLabel="Reject"
        onConfirm={reject}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
