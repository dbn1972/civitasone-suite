/**
 * Shared test support for event-service's DB-backed integration suite.
 * Mirrors services/vendor-service/tests/support.ts (the fleet reference for
 * this pattern) and services/animal-service/tests/support.ts.
 *
 * Writes are queue-first (202 Accepted, F3/CQRS pattern): a route publishes
 * a command, and the domain side-effect (DB row, outbox event, audit row)
 * only applies once the module's real consumer processes it off the shared
 * infra queue. Tests register the real consumers (mirroring src/worker.ts)
 * and drain the in-memory queue before asserting persisted state.
 */
import type { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { queue } from "../src/shared/infra.js";

export const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

export const TENANT_A = "a1111111-0000-4000-8000-000000000001";
export const TENANT_B = "b2222222-0000-4000-8000-000000000002";
export const ACTOR_A = "c3333333-0000-4000-8000-00000000000a";
export const ACTOR_B = "c3333333-0000-4000-8000-00000000000b";

export function hdr(
  sub = ACTOR_A,
  tid = TENANT_A,
  roles: string[] = ["event_admin", "super_admin"],
): { authorization: string; "x-tenant-id": string } {
  // x-tenant-id is normally set by the gateway from the validated JWT before
  // proxying to the service; app.ts's onRequest hooks (createTenantTxHook +
  // the G2 authenticated-tenant hook) read it to seed the AsyncLocalStorage
  // tenant context that RLS's `app.tenant_id` GUC is set from. app.inject()
  // bypasses the gateway, so tests must supply it explicitly.
  return {
    authorization: `Bearer ${signToken({ sub, tid, roles, sid: "test-session" }, SECRET, 3600)}`,
    "x-tenant-id": tid,
  };
}

export async function drainQueue(): Promise<void> {
  await (queue as MemoryQueue).drain();
}

export async function waitFor(fn: () => Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await drainQueue();
    await new Promise<void>((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}
