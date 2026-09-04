/**
 * Shared test support for drainage-service's DB-backed integration suite.
 * Mirrors services/fire-service/tests/support.ts (PR #1011) and
 * services/animal-service/tests/support.ts (PR #1007).
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

// These are deliberately single-role sets for the test PRINCIPAL's own JWT
// roles claim -- NOT the routes' `ROLES`/`ADMIN_ROLES` allow-list constants
// (routes.ts's ADMIN_ROLES = ["drainage_admin", "super_admin"] is what the
// server checks against; hdr()'s `roles` becomes the CALLER's own roles).
// Signing a token with the full allow-list as the caller's roles would give
// every test principal admin access, silently defeating every "non-admin is
// forbidden" assertion in this suite.
export const ADMIN_ROLES = ["drainage_admin"];
export const USER_ROLES = ["drainage_user"];
export const SUPER_ADMIN_ROLES = ["super_admin"];

export function hdr(
  sub = ACTOR_A,
  tid = TENANT_A,
  roles: string[] = USER_ROLES,
): { authorization: string; "x-tenant-id": string } {
  // x-tenant-id is normally set by the gateway from the validated JWT before
  // proxying to the service; app.ts's onRequest hooks (createTenantTxHook +
  // the G2 authenticated-tenant hook, PR #999) read it to seed the
  // AsyncLocalStorage tenant context that RLS's `app.tenant_id` GUC is set
  // from. app.inject() bypasses the gateway, so tests must supply it
  // explicitly.
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
