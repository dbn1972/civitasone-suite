/**
 * CH-11 — Tenant-scoped read helper for broadcast module.
 */
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";

type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function scopedRead<T>(tenantId: string, fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}
