"use client";

import { SETUP_SKIPPED_STEPS_KEY } from "@/lib/setupSteps";

/**
 * GAP-SETUP-HOME-02 — persist a per-tenant setup-step deferral.
 *
 * The deferral is stored in the generic tenant-settings key/value store
 * (tenant-service `/v1/settings`, proxied as `/api/proxy/v1/tenant/settings`),
 * which already provides CQRS + a mandatory audit event + tenant scoping +
 * admin role gating. The value under `setup.skipped_steps` is the full array of
 * skipped step keys; we read the current list, union the new key, and PUT the
 * result (last-writer-wins is fine for a per-tenant preference list).
 *
 * Returns true only when the write was accepted (202). A false result means the
 * caller must NOT claim the skip was saved — the UI then navigates away with an
 * honest "couldn't save" note instead of a false "deferred" promise.
 */
export async function persistSkippedStep(stepKey: string): Promise<boolean> {
  try {
    const current = await readSkippedSteps();
    const next = Array.from(new Set([...current, stepKey]));
    const res = await fetch("/api/proxy/v1/tenant/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: SETUP_SKIPPED_STEPS_KEY, value: next }),
    });
    return res.ok || res.status === 202;
  } catch {
    return false;
  }
}

/** Remove a step from the persisted skip list (un-skip). Returns true on accept. */
export async function unskipStep(stepKey: string): Promise<boolean> {
  try {
    const current = await readSkippedSteps();
    const next = current.filter((k) => k !== stepKey);
    const res = await fetch("/api/proxy/v1/tenant/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: SETUP_SKIPPED_STEPS_KEY, value: next }),
    });
    return res.ok || res.status === 202;
  } catch {
    return false;
  }
}

async function readSkippedSteps(): Promise<string[]> {
  try {
    const res = await fetch(`/api/proxy/v1/tenant/settings/${encodeURIComponent(SETUP_SKIPPED_STEPS_KEY)}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { value?: unknown } | unknown;
    const value =
      json && typeof json === "object" && "value" in (json as object) ? (json as { value: unknown }).value : json;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
