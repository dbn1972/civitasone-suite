/**
 * Shared test support for swm-service smoke tests.
 *
 * Writes are queue-first (202 Accepted, F3 pattern) — the domain side-effect
 * (DB row, outbox event, audit) applies inside the module's consumer. Tests
 * register the real consumers on the shared infra queue (mirroring
 * src/worker.ts) and drain the in-memory queue before asserting projected
 * state, exactly like services/estab-service/tests/spaces-routes.test.ts.
 */
import type { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { queue } from "../src/shared/infra.js";

export const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

export const TENANT_A = "44444444-cccc-4000-8000-000000000001";
export const TENANT_B = "44444444-cccc-4000-8000-000000000002";
export const ACTOR_A = "55555555-cccc-4000-8000-00000000000a";
export const ACTOR_B = "55555555-cccc-4000-8000-00000000000b";

export function hdr(
  sub = ACTOR_A,
  tid = TENANT_A,
  roles: string[] = ["swm_admin", "super_admin"],
): { authorization: string; "x-tenant-id": string } {
  // x-tenant-id is normally set by the gateway from the validated JWT before
  // proxying to the service; createTenantTxHook (src/app.ts, via
  // @civitasone/db) reads it directly to seed the AsyncLocalStorage tenant
  // context that wrapWithTenantGuc uses to SET LOCAL app.tenant_id for RLS.
  // Tests bypass the gateway, so it must be set explicitly here too.
  return {
    authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s1" }, SECRET, 3600)}`,
    "x-tenant-id": tid,
  };
}

export async function drainQueue(): Promise<void> {
  const q = queue as MemoryQueue;
  if (typeof q.drain === "function") await q.drain();
  else await new Promise<void>((r) => setTimeout(r, 400));
}

export async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await drainQueue();
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}
