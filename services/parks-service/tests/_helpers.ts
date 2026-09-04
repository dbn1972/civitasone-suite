/**
 * Shared test helpers for parks-service's DB-backed test suite.
 *
 * Every test file in this directory hits the REAL Postgres configured by
 * vitest.config.ts's DATABASE_URL (QUEUE_DRIVER=memory, so commands
 * published by a route are delivered in-process by the same MemoryQueue
 * instance a test registers its consumers on). No repo/db mocking anywhere
 * in this suite — the whole point of the bugs fixed alongside it (orphan
 * inspection rows, Date.now()-based number collisions, RLS scoping) is
 * where state actually lives; a mocked db cannot exercise any of that.
 */
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";

export const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

export function makeToken(tenantId: string, actorId: string, roles: string[]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: `sess-${randomUUID()}` }, SECRET, 3600);
}

export function authHeader(tenantId: string, actorId: string, roles: string[]) {
  return { authorization: `Bearer ${makeToken(tenantId, actorId, roles)}` };
}

export const ADMIN_ROLES = ["parks_admin"];
export const USER_ROLES = ["parks_user"];

/**
 * Waits for every MemoryQueue delivery in flight (from a just-completed
 * app.inject() that published a command) to fully settle, including any
 * retry backoff, before the test asserts persisted state. Uses the queue's
 * own drain() test aid (services/queue-service/src/bus.ts) instead of a
 * fixed sleep — deterministic rather than racy.
 */
export async function drainQueue(queue: unknown): Promise<void> {
  const q = queue as { drain?: () => Promise<void> };
  if (typeof q.drain === "function") {
    await q.drain();
  } else {
    // Fallback for a non-MemoryQueue driver: give in-process delivery a tick.
    await new Promise((r) => setTimeout(r, 100));
  }
}
