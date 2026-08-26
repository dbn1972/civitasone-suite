/**
 * Integration test: identity verification ownership enforcement (Fix 1).
 *
 * SECURITY AUDIT FINDING, now fixed (CRITICAL — cross-actor IDOR, CWE-639):
 * `POST /v1/visitor/visit-requests/:id/verify-identity` (identity/routes.ts)
 * used to allow any authenticated caller whose ROLE was in VERIFY_ROLES —
 * which explicitly includes the lowest-privilege "visitor" role, per the
 * route's own comment ("the visitor themselves, via citizen portal") — to
 * trigger identity verification for ANY visitRequestId in their tenant, not
 * just one they own.
 *
 * This was verified live against the running audit instance (port 3035)
 * before the fix: a "visitor"-role token for an actor with ZERO
 * relationship to a visit-request created by a different actor/role was
 * able to flip that foreign row's `identity_method` to "manual" and
 * `updated_by` to the attacker's own actor id — a real, unauthorized write
 * to another visitor's record.
 *
 * The fix lives at the route boundary (identity/routes.ts): it now loads
 * the target visit request (visit-request/repo.js#getVisitRequestById) and,
 * for the "visitor" role specifically, requires the caller to be the
 * request's visitor/host/creator — rejecting with 403 BEFORE anything is
 * published to the queue, so the consumer never even sees the command. This
 * test drives the real, unmocked route (via `buildApp()` + `app.inject`,
 * matching the identical pattern used for the analogous cross-host IDOR fix
 * in `visit-request-approval-idor.integration.test.ts`) against the real
 * Postgres-backed fixture, and confirms the row is left untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { sqlClient, db, scopedRead } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
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

function attackerAuth(): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: ATTACKER_ACTOR, tid: TENANT, roles: ["visitor"], sid: "sess-attacker" }, SECRET, 3600)}` };
}

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

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(locations).where(eq(locations.id, LOCATION))));
  await sqlClient.end();
});

describe("identity verification — ownership enforced end-to-end (Fix 1)", () => {
  it("digilockerVerify: an unrelated 'visitor'-role actor is rejected (403) and the foreign row is left untouched", async () => {
    const vrId = randomUUID();
    await seedVisitRequest(vrId);

    const before = await readRow(vrId);
    expect(before?.updatedBy).toBe(HOST_ACTOR);
    expect(before?.identityMethod).toBeNull();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${vrId}/verify-identity`,
      headers: attackerAuth(),
      payload: { identityMethod: "digilocker", digilockerUri: "attacker-controlled-uri" },
    });
    await app.close();

    // Fixed: the route rejects before publishing anything — no command
    // ever reaches the consumer, so the row cannot have been mutated.
    expect(res.statusCode).toBe(403);

    const after = await readRow(vrId);
    expect(after?.updatedBy).toBe(HOST_ACTOR);
    expect(after?.identityMethod).toBeNull();

    await cleanup(vrId);
  }, 15000);

  it("aadhaarFaceMatch: an unrelated 'visitor'-role actor is rejected (403) even with confidenceThreshold=0", async () => {
    const vrId = randomUUID();
    await seedVisitRequest(vrId);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${vrId}/verify-identity`,
      headers: attackerAuth(),
      payload: {
        identityMethod: "aadhaar_face",
        aadhaarRef: "attacker-ref",
        livePhotoBase64: "ZmFrZQ==",
        // Fix 2: even a caller-supplied confidenceThreshold=0 no longer
        // matters here — the request never gets far enough to reach
        // aadhaar-face-adapter.ts, because the ownership check (Fix 1)
        // rejects it first.
        confidenceThreshold: 0,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(403);

    const after = await readRow(vrId);
    expect(after?.updatedBy).toBe(HOST_ACTOR);

    await cleanup(vrId);
  }, 15000);

  it("the legitimate host CAN still verify identity on their own visit request", async () => {
    const vrId = randomUUID();
    await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.insert(visitRequests).values({
          id: vrId, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: HOST_ACTOR,
          visitorName: "Legit Visitor", visitorPhone: "+911234500001",
          createdBy: HOST_ACTOR, updatedBy: HOST_ACTOR,
        }),
      ),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/visitor/visit-requests/${vrId}/verify-identity`,
      headers: { authorization: `Bearer ${signToken({ sub: HOST_ACTOR, tid: TENANT, roles: ["visitor"], sid: "sess-host" }, SECRET, 3600)}` },
      payload: { identityMethod: "digilocker", digilockerUri: "https://digilocker.gov/legit" },
    });
    await app.close();

    // hostEmployeeId matches the caller's own actorId here, so ownership
    // is satisfied and the request is accepted for async processing.
    expect(res.statusCode).toBe(202);

    await cleanup(vrId);
  }, 15000);
});
