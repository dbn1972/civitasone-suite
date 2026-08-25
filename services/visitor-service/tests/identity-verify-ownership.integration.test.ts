/**
 * Integration test: identity verification has NO ownership check.
 *
 * SECURITY AUDIT FINDING (CRITICAL — cross-actor IDOR, CWE-639):
 * `POST /v1/visitor/visit-requests/:id/verify-identity` (identity/routes.ts)
 * allows any authenticated caller whose ROLE is in VERIFY_ROLES — which
 * explicitly includes the lowest-privilege "visitor" role, per the route's
 * own comment ("the visitor themselves, via citizen portal") — to trigger
 * identity verification for ANY visitRequestId in their tenant, not just
 * one they own. Neither the route (identity/routes.ts) nor the command
 * publishers (identity/commands.ts) nor the consumer (identity/consumer.ts)
 * ever compares the visit request's `visitorId`/`hostEmployeeId`/creator to
 * `ctx.actorId` — the ONLY scoping anywhere in the path is `tenantId`.
 *
 * This was verified live against the running audit instance (port 3035):
 * a "visitor"-role token for an actor with ZERO relationship to a
 * visit-request created by a different actor/role was able to flip that
 * foreign row's `identity_method` to "manual" and `updated_by` to the
 * attacker's own actor id — a real, unauthorized write to another
 * visitor's record.
 *
 * This test reproduces that live finding deterministically against the
 * real DB (RLS-scoped writes via the visitor_svc pool), driving the
 * consumer directly via a real MemoryQueue — mirroring the conventions of
 * tenant-isolation.integration.test.ts (real DB fixture) and
 * blacklist-consumer.test.ts (MemoryQueue + registerXConsumers + flush).
 *
 * Both identity commands are exercised: digilockerVerify and
 * aadhaarFaceMatch. Neither DIGILOCKER_ENABLED nor AADHAAR_FACE_MATCH_ENABLED
 * is set in the test environment, so both adapters fail-closed to
 * "unavailable" — which is precisely the branch that still mutates the
 * foreign row (identityMethod: "manual", updatedBy: msg.actorId), so no
 * adapter mocking is required to prove the ownership gap.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";
import { registerIdentityConsumers } from "../src/modules/identity/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();

// The legitimate host who created the visit request.
const HOST_ACTOR = randomUUID();

// A completely unrelated, lower-privileged actor: no relationship to the
// visit request whatsoever (not the visitor, not the host, not staff who
// created/approved it). Represents an authenticated "visitor"-role citizen
// attacking a stranger's pending visit request.
const ATTACKER_ACTOR = randomUUID();

const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

async function seedVisitRequest(id: string): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Audit Location", businessHours: BUSINESS_HOURS,
        createdBy: HOST_ACTOR, updatedBy: HOST_ACTOR,
      }).onConflictDoNothing();
      await tx.insert(visitRequests).values({
        id, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: randomUUID(),
        visitorName: "Victim Visitor", visitorPhone: "+911234500000",
        createdBy: HOST_ACTOR, updatedBy: HOST_ACTOR,
      });
    }),
  );
}

async function readRow(id: string) {
  const rows = await runWithTenant(TENANT, () =>
    scopedRead((tx) => tx.select().from(visitRequests).where(eq(visitRequests.id, id))),
  );
  return rows[0];
}

async function cleanup(id: string): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(visitRequests).where(eq(visitRequests.id, id))),
  );
}

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  // visitor.* tables are FORCE ROW LEVEL SECURITY; under the NOBYPASSRLS
  // visitor_svc role a consumer's db.transaction() only sees/affects its
  // tenant's rows when app.tenant_id is set. In production this GUC-scoping
  // is applied by a single wrap in worker.ts (`q.subscribe = (topic,
  // handler) => rawSubscribe(topic, (msg) => runWithTenant(msg.tenantId,
  // () => handler(msg)))`) BEFORE any register*Consumers(queue) call — it is
  // not something registerIdentityConsumers (or any consumer module) does
  // itself. Reproduce that exact wrap here so this test exercises the real
  // RLS-scoped write path, matching how the handler actually runs in prod.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));

  registerIdentityConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, actorId: string): Promise<void> {
  await queue.publish(topic, {
    type: topic,
    tenantId: TENANT,
    actorId,
    correlationId: "corr-audit-idor",
    schemaVersion: "1.0",
    payload,
  });
  // MemoryQueue delivers via setTimeout(0), but the handler itself does a
  // real Postgres round trip (GUC-scoped tx: select + update + 2 outbox
  // enqueues) — unlike the mocked-db convention in blacklist-consumer.test.ts,
  // so a short fixed delay is flaky here. Give it real headroom.
  await new Promise((r) => setTimeout(r, 800));
}

/** Poll until the row's updatedBy diverges from the seeded creator (or timeout). */
async function waitForMutation(id: string, seededBy: string, timeoutMs = 5000): Promise<Awaited<ReturnType<typeof readRow>>> {
  const deadline = Date.now() + timeoutMs;
  let row = await readRow(id);
  while (row?.updatedBy === seededBy && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    row = await readRow(id);
  }
  return row;
}

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(locations).where(eq(locations.id, LOCATION))));
});

describe("identity verification consumer — missing ownership check (IDOR)", () => {
  it("digilockerVerify: an unrelated actor can mutate a foreign visit request's identity fields", async () => {
    const vrId = randomUUID();
    await seedVisitRequest(vrId);

    const before = await readRow(vrId);
    expect(before?.updatedBy).toBe(HOST_ACTOR);
    expect(before?.identityMethod).toBeNull();

    const queue = freshQueue();
    // ATTACKER_ACTOR has no relationship to vrId whatsoever, yet the
    // consumer accepts and processes the command purely on (id, tenantId).
    await publishAndFlush(
      queue,
      COMMANDS.digilockerVerify,
      { visitRequestId: vrId, digilockerUri: "attacker-controlled-uri" },
      ATTACKER_ACTOR,
    );

    const after = await waitForMutation(vrId, HOST_ACTOR);
    // BUG: the row was mutated by an actor with zero relationship to it.
    // A correctly-scoped implementation would reject this (403/ignored),
    // leaving updatedBy/identityMethod unchanged.
    expect(after?.updatedBy).toBe(ATTACKER_ACTOR);
    expect(after?.identityMethod).toBe("manual");

    await cleanup(vrId);
  }, 15000);

  it("aadhaarFaceMatch: an unrelated actor can mutate a foreign visit request's identity fields", async () => {
    const vrId = randomUUID();
    await seedVisitRequest(vrId);

    const queue = freshQueue();
    await publishAndFlush(
      queue,
      COMMANDS.aadhaarFaceMatch,
      {
        visitRequestId: vrId,
        aadhaarRef: "attacker-ref",
        livePhotoBase64: "ZmFrZQ==",
        // Client-controlled confidenceThreshold (see identity/routes.ts
        // verifyIdentityBody -> aadhaarFaceBody): zod only bounds it to
        // [0, 100] with no floor and no role gate. Any caller — including
        // the lowest-privilege "visitor" role — can force a match by
        // setting this to 0, since matchFace() accepts when
        // `confidence >= confidenceThreshold` and confidence is never
        // negative. Not independently exercised here (the adapter is
        // env-gated off in this test environment, so the flow always takes
        // the fail-closed "unavailable" branch), but is a genuine,
        // separately-reproducible gap in identity/routes.ts +
        // identity/aadhaar-face-adapter.ts: see the existing
        // aadhaar-face-adapter.test.ts case "honours a tenant-configurable
        // confidenceThreshold override — passes at the override value",
        // which proves matchFace(input, 0) matches at any confidence >= 0.
        confidenceThreshold: 0,
      },
      ATTACKER_ACTOR,
    );

    const after = await waitForMutation(vrId, HOST_ACTOR);
    expect(after?.updatedBy).toBe(ATTACKER_ACTOR);

    await cleanup(vrId);
  }, 15000);
});
