/**
 * SEC-015 — wires the real login flow to identity-service's existing (but,
 * until this fix, never-invoked-in-production) `POST /identity/sessions`
 * route, keyed by the access token's own `sid` claim, so SEC-006's
 * revoke-by-sid denylist has a live session to correlate against.
 *
 * Per docs/TEST-INFRA.md §3, every test environment in this repo uses HS256
 * test tokens (`signToken`) instead of a real Keycloak instance — the same
 * convention `sessions-apikeys-routes.test.ts`, SEC-006/008/023/024's own
 * tests, and every other suite in this service already follow. There is no
 * existing real-Keycloak test harness/convention anywhere in this repo to
 * build on, so this test drives the REAL, unmocked application code path a
 * login now exercises (Fastify route → authPlugin verification → commands →
 * the real queue → the real consumer → a real disposable Postgres) with an
 * HS256 token carrying a realistic (uuid-shaped) `sid`, exactly as apps/web's
 * OAuth callback route would receive one from Keycloak. What is NOT
 * exercised is Keycloak's own token minting/signing — everything downstream
 * of "a verified token with a sid claim exists" is real.
 *
 * This is the end-to-end proof the DoD asks for, not a unit test of
 * commands.createSession in isolation:
 *   1. POST /identity/sessions, self-service (ctx.actorId === body.userId),
 *      simulating what apps/web's callback route now does right after a
 *      successful login.
 *   2. The real consumer (registerSessionConsumers, wired onto the SAME
 *      queue singleton commands.ts publishes to — shared/infra.ts's `queue`
 *      — wrapped with runWithTenant exactly like worker.ts and like
 *      sec-006-session-revoke-denylist.db.test.ts's own wireTenantAwareQueue)
 *      writes the row; assert its id equals the token's sid.
 *   3. The SAME token, presented to a real authPlugin-protected route,
 *      works — baseline before revoke.
 *   4. DELETE /identity/sessions/:id — SEC-006's existing revoke mechanism.
 *   5. THE CRUX: the SAME, still cryptographically-valid, unexpired token —
 *      never reissued — is now rejected. This is SEC-006's own DoD
 *      ("revoke -> next request with the old token is 401 on every
 *      service"), demonstrated end-to-end for the first time: previously
 *      nothing created this row, so SEC-006's denylist had no live session
 *      to revoke (see SEC-006's own gap-report row, which explicitly says
 *      so).
 *
 * Sabotage check (actually run; see PR description for the full transcript):
 * `git checkout` routes.ts + commands.ts back to always-random-id, this file
 * unchanged. Result: the first test fails immediately at the id===sid
 * assertion (created id was a random uuid, not the token's sid — so it never
 * reaches the revoke-then-401 assertions further down, but those are
 * equally dependent on this fix: the DELETE would target a random id
 * nothing denylists, so the same token would still 200 afterward). The third
 * test ("rejects ... when the token has no sid") independently regresses on
 * its own — 202 instead of 400 — proving the fail-closed check is real, not
 * just the id substitution. Restoring both files returns all three to green.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { isSessionDenylisted, __setDenylistStoreForTests } from "@civitasone/auth/denylist";
import { MemoryCache } from "@civitasone/cache";
import { runWithTenant } from "@civitasone/db";
import type { Queue } from "@civitasone/queue";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c15c15c1-5015-4000-8000-0000000c15c1";
const USER = "c15c15c1-5015-4000-8000-0000000000e5";
const SID = "c15c15c1-5015-4000-8000-00000000515d"; // realistic uuid-shaped sid, as Keycloak issues

function loginToken(): string {
  return signToken({ sub: USER, tid: TENANT, roles: ["employee"], sid: SID } as never, SECRET);
}

// Mirrors worker.ts (src/worker.ts) and sec-006-session-revoke-denylist.db.test.ts's
// own wireTenantAwareQueue EXACTLY: consumers call db.transaction() and RLS
// (sessions.sessions is FORCE ROW LEVEL SECURITY) requires the app.tenant_id
// GUC to be set, which production achieves by wrapping queue.subscribe() to
// run every handler inside runWithTenant(msg.tenantId, ...). Without this,
// the real consumer would silently affect/insert zero rows for every tenant.
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

// Poll instead of a fixed sleep: vitest.config.ts's own hookTimeout comment
// (REL-024) documents that this exact service's heavier route-inject suites
// (sessions-apikeys-routes.test.ts by name) see real scheduling contention
// when several buildApp()-based files share one CI/dev box's CPU and one
// disposable Postgres -- a fixed 500ms wait (sec-006's own convention) is
// comfortable in isolation but not guaranteed under that contention. Polling
// still resolves fast on a quiet box and simply tolerates the slow case
// instead of flaking on it.
async function waitFor<T>(check: () => Promise<T>, isReady: (v: T) => boolean, timeoutMs = 5000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (isReady(value)) return value;
    if (Date.now() >= deadline) return value; // let the caller's own assertion report the failure
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

let app: FastifyInstance;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessions: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processed: any;

// SID doubles as this command's messageId (commands.ts: `messageId: id`), and
// EVT-4's dedup ledger (_inbox.processed, packages/outbox/src/index.ts) is
// keyed on messageId ALONE with no tenant scoping or TTL that a test
// controls. A fixed, readable SID constant (rather than randomUUID() per
// run, which is what lets sec-006's own test skip this) means a second run
// against the SAME database -- exactly what repeated local test runs against
// one disposable Postgres do -- would otherwise find messageId=SID already
// marked processed and silently no-op the insert (markProcessed returns
// false, the consumer returns early, no error, no row). Clearing it here
// makes the row-creation assertions deterministic across repeated runs, not
// just the first one.
async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction((tx: typeof db) => tx.delete(sessions).where(eq(sessions.tenantId, TENANT))));
  await db.delete(processed).where(eq(processed.messageId, SID));
}

beforeAll(async () => {
  // Dedicated in-memory denylist store for this file only, matching
  // sec-006-session-revoke-denylist.db.test.ts's own isolation rationale.
  __setDenylistStoreForTests(new MemoryCache());

  const { buildApp } = await import("../src/app.js");
  app = await buildApp();

  ({ db } = await import("../src/shared/db.js"));
  ({ sessions } = await import("../src/modules/sessions/schema.js"));
  ({ processed } = await import("../src/shared/outbox.js"));

  // Register the REAL consumer onto the SAME queue singleton routes.ts's
  // commands.createSession/revokeSession publish to (shared/infra.ts's
  // `queue` — a single in-process instance for the lifetime of this test
  // file's module graph, since QUEUE_DRIVER=memory per docs/TEST-INFRA.md).
  // This is what actually lets `app.inject()` alone drive the full
  // route -> command -> queue -> consumer -> Postgres path.
  const { queue } = await import("../src/shared/infra.js");
  const { registerSessionConsumers } = await import("../src/modules/sessions/consumer.js");
  registerSessionConsumers(wireTenantAwareQueue(queue as unknown as Queue));
  await (queue as unknown as Queue).start();

  await cleanup();
});

afterAll(async () => {
  await cleanup();
  __setDenylistStoreForTests(null);
  await app.close();
});

describe("SEC-015 — login creates a sid-keyed session; SEC-006 revoke then rejects it fleet-wide", () => {
  it("logging in creates a sessions row whose id equals the token's sid, and revoking it then 401s that same live token", async () => {
    const token = loginToken();

    // 1) Simulate what apps/web's OAuth callback now does right after a
    // successful login: call the real route with the fresh token.
    const createRes = await app.inject({
      method: "POST",
      url: "/identity/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { tenantId: TENANT, userId: USER, ip: "203.0.113.7", device: "vitest-e2e" },
    });
    expect(createRes.statusCode).toBe(202);
    expect(createRes.json().id).toBe(SID); // <- the DoD itself: id === the token's sid

    // 2) The real consumer actually wrote the row (not just accepted the
    // command) — poll for it rather than a fixed sleep (see waitFor's
    // doc-comment for why).
    const rows = await waitFor(
      () => runWithTenant(TENANT, () =>
        db.transaction((tx: typeof db) => tx.select().from(sessions).where(eq(sessions.id, SID)))),
      (r) => r.length > 0,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(SID);
    expect(rows[0].userId).toBe(USER);
    expect(rows[0].tenantId).toBe(TENANT);

    // 3) That same token, presented to a real authPlugin-protected route,
    // still works — baseline before revoke (also confirms it isn't
    // pre-emptively denylisted).
    expect(await isSessionDenylisted(SID)).toBe(false);
    const beforeRevoke = await app.inject({
      method: "GET",
      url: `/identity/sessions/${SID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(beforeRevoke.statusCode).toBe(200);

    // 4) Revoke via SEC-006's existing mechanism (DELETE, self-service: the
    // owner revoking their own session).
    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/identity/sessions/${SID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revokeRes.statusCode).toBe(202);
    expect(await waitFor(() => isSessionDenylisted(SID), (v) => v === true)).toBe(true);

    // 5) THE CRUX: the SAME, still cryptographically-valid, unexpired token
    // — never reissued or refreshed — is now rejected. SEC-006's own DoD
    // ("revoke -> next request with the old token is 401 on every
    // service"), demonstrated end-to-end for the first time because step 1
    // is what SEC-015 adds — previously nothing created this row, so
    // SEC-006's denylist had nothing real to revoke.
    const afterRevoke = await app.inject({
      method: "GET",
      url: `/identity/sessions/${SID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
  }, 20_000);
  // ^ vitest's default per-test timeout (5s) is tight for this test: it does
  // two real async queue -> consumer -> Postgres round trips (via waitFor),
  // each individually bounded but able to legitimately take a few seconds
  // under host contention -- the same class of slowdown vitest.config.ts's
  // own hookTimeout comment (REL-024) documents for this service's other
  // buildApp()-based suites when several run concurrently against one
  // disposable Postgres. 20s leaves comfortable headroom without masking a
  // real hang (waitFor itself still gives up and reports a failed assertion
  // well before that).

  it("does not require a sid for the admin-creates-a-session-for-another-user path (pre-existing behaviour, unaffected)", async () => {
    const adminSid = randomUUID();
    const adminToken = signToken(
      { sub: randomUUID(), tid: TENANT, roles: ["super_admin"], sid: adminSid } as never,
      SECRET,
    );
    const targetUser = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/identity/sessions",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { tenantId: TENANT, userId: targetUser, ip: "203.0.113.8" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    // Must NOT silently reuse the admin's own sid for someone else's session.
    expect(body.id).not.toBe(adminSid);
  });

  it("rejects self-service session creation when the token has no sid (fails closed, not silently)", async () => {
    const noSidToken = signToken({ sub: USER, tid: TENANT, roles: ["employee"] } as never, SECRET); // no sid field
    const res = await app.inject({
      method: "POST",
      url: "/identity/sessions",
      headers: { authorization: `Bearer ${noSidToken}` },
      payload: { tenantId: TENANT, userId: USER, ip: "203.0.113.9" },
    });
    expect(res.statusCode).toBe(400);
  });
});
