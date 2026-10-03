"use client";

import { ActionButton } from "@/app/_components/ds";
import { decisionFailure } from "@/lib/decisionError";

/** How long to wait for the asynchronous status command to land before telling the user it is queued. */
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 500;

/**
 * Polls the bin register until `binId` shows `isActive`, because the PATCH only
 * enqueues the command (202). Returns true once the new state is visible.
 */
export async function waitForBinState(binId: string, isActive: boolean): Promise<boolean> {
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const res = await fetch("/api/proxy/v1/inventory/bins?limit=200");
      if (!res.ok) continue;
      const body = (await res.json()) as { data?: Array<{ id?: string; isActive?: boolean }> };
      const row = body.data?.find((b) => b.id === binId);
      if (row && row.isActive === isActive) return true;
    } catch {
      /* keep polling; a transient failure must not look like a failed change */
    }
  }
  return false;
}

/**
 * Activate / deactivate one bin (GAP-INVENTORY-BINS-03). Behind a confirm dialog;
 * the service rejects a repeat (409) and a missing bin (404) synchronously.
 */
export function BinStatusAction({
  binId,
  code,
  isActive,
  onChanged,
}: {
  binId: string;
  code: string;
  isActive: boolean;
  /** Called with the new state once it is confirmed (or best-effort when still queued). */
  onChanged: (binId: string, isActive: boolean, confirmed: boolean) => void;
}) {
  const target = !isActive;

  async function change(): Promise<void> {
    const res = await fetch(`/api/proxy/v1/inventory/bins/${binId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: target }),
    });
    if (!res.ok) {
      const failure = await decisionFailure(res, "bin");
      // A 409 means the bin is already in that state: surface it, do not pretend it changed.
      throw new Error(res.status === 409 ? `Bin ${code} is already ${target ? "active" : "inactive"}. Refresh to see the latest.` : failure.message);
    }
    const confirmed = await waitForBinState(binId, target);
    onChanged(binId, target, confirmed);
  }

  return (
    <ActionButton
      label={isActive ? "Deactivate" : "Reactivate"}
      className="btn ghost"
      danger={isActive}
      confirmTitle={isActive ? `Deactivate bin ${code}?` : `Reactivate bin ${code}?`}
      confirmDescription={
        isActive
          ? "The bin stays on the register as Inactive and can be reactivated later. This is recorded in the audit log."
          : "The bin becomes Active again. This is recorded in the audit log."
      }
      confirmLabel={isActive ? "Deactivate" : "Reactivate"}
      onConfirm={change}
    />
  );
}
