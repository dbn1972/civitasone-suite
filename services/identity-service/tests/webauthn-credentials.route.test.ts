/**
 * WebAuthn credential delete — DOM-005 regression tests.
 *
 * Before the fix, DELETE /v1/identity/webauthn/credentials/:id returned 204
 * without checking who owns the credential and without deleting anything —
 * a fabricated success for a security-relevant operation. These tests seed a
 * real row directly via the repo (registration itself is still honestly
 * 501'd — see webauthn/routes.ts POST /register — so there is no API path
 * that creates one yet) and assert:
 *   1. a user CANNOT delete another user's credential (ownership enforced,
 *      row untouched), and
 *   2. the owner's delete actually removes the row, not just returns 204.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddddddd-3333-4000-8000-0000000000d1";

function token(sub: string, roles: string[] = ["employee"]): string {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-webauthn-1" } as never, SECRET);
}
const headers = (sub: string) => ({ authorization: `Bearer ${token(sub)}` });

// FLAKY-SKIP: Requires DATABASE_URL/DB_URL against a real Postgres for the DOM-005 real-deletion ownership check; unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN_DB)("WebAuthn credential delete — ownership + real deletion (DOM-005)", () => {
  let app: FastifyInstance;
  let repo: typeof import("../src/modules/webauthn/repo.js");

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    repo = await import("../src/modules/webauthn/repo.js");
  });
  afterAll(async () => { await app.close(); });

  async function seedCredential(ownerId: string) {
    return runWithTenant(TENANT, () => repo.insert({
      tenantId: TENANT,
      userId: ownerId,
      credentialId: `cred-${randomUUID()}`,
      publicKey: "test-public-key-placeholder",
      signCount: 0,
    }));
  }

  it("DELETE without a token → 401", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/identity/webauthn/credentials/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it("a user CANNOT delete another user's credential — 404, row untouched", async () => {
    const owner = randomUUID();
    const attacker = randomUUID();
    const cred = await seedCredential(owner);

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/identity/webauthn/credentials/${cred.id}`,
      headers: headers(attacker),
    });
    expect(res.statusCode).toBe(404);

    // The row must still be there — this used to be a no-op 204 with no
    // ownership check at all, so a wrong 204 alone wouldn't have caught the
    // bug; asserting persistence is the actual regression guard.
    const stillThere = await runWithTenant(TENANT, () => repo.findById(TENANT, cred.id));
    expect(stillThere).not.toBeNull();
    expect(stillThere?.id).toBe(cred.id);
  });

  it("the owner's delete returns 204 AND actually removes the row", async () => {
    const owner = randomUUID();
    const cred = await seedCredential(owner);

    // sanity: it exists before delete
    const before = await runWithTenant(TENANT, () => repo.findById(TENANT, cred.id));
    expect(before).not.toBeNull();

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/identity/webauthn/credentials/${cred.id}`,
      headers: headers(owner),
    });
    expect(res.statusCode).toBe(204);

    const after = await runWithTenant(TENANT, () => repo.findById(TENANT, cred.id));
    expect(after).toBeNull();
  });

  it("deleting an already-deleted (or unknown) credential id → 404, not a false 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/identity/webauthn/credentials/${randomUUID()}`,
      headers: headers(randomUUID()),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /credentials only lists the caller's own credentials", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const ownerCred = await seedCredential(owner);
    const otherCred = await seedCredential(other);

    const res = await app.inject({
      method: "GET", url: "/v1/identity/webauthn/credentials",
      headers: headers(owner),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(ownerCred.id);
    expect(ids).not.toContain(otherCred.id);
    expect(body.total).toBe(body.data.length);
  });
});


// GAP-IDENTITY-WEBAUTHN-02: PATCH rename tests
// FLAKY-SKIP: Requires live DB (RUN_DB env gate); skipped in CI sandbox. (expires: 2027-04-16)
describe.skipIf(!RUN_DB)("WebAuthn credential rename -- ownership + real rename (GAP-IDENTITY-WEBAUTHN-02)", () => {
  let app: FastifyInstance;
  let repo: typeof import("../src/modules/webauthn/repo.js");

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    repo = await import("../src/modules/webauthn/repo.js");
  });
  afterAll(async () => { await app.close(); });

  async function seedCredential(ownerId: string, deviceName?: string) {
    return runWithTenant(TENANT, () => repo.insert({
      tenantId: TENANT,
      userId: ownerId,
      credentialId: `cred-${randomUUID()}`,
      publicKey: "test-public-key-placeholder",
      signCount: 0,
      deviceName: deviceName ?? "Original name",
    }));
  }

  it("PATCH without a token -> 401", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/identity/webauthn/credentials/${randomUUID()}`, payload: { deviceName: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("the owner can rename their credential -- 200, deviceName updated in DB", async () => {
    const owner = randomUUID();
    const cred = await seedCredential(owner, "Old name");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/identity/webauthn/credentials/${cred.id}`,
      headers: headers(owner),
      payload: { deviceName: "New name" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deviceName).toBe("New name");
    expect(body.id).toBe(cred.id);

    const row = await runWithTenant(TENANT, () => repo.findById(TENANT, cred.id));
    expect(row?.deviceName).toBe("New name");
  });

  it("a different user CANNOT rename another user's credential -- 404, row untouched", async () => {
    const owner = randomUUID();
    const attacker = randomUUID();
    const cred = await seedCredential(owner, "Victim key");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/identity/webauthn/credentials/${cred.id}`,
      headers: headers(attacker),
      payload: { deviceName: "Hacked" },
    });
    expect(res.statusCode).toBe(404);

    const row = await runWithTenant(TENANT, () => repo.findById(TENANT, cred.id));
    expect(row?.deviceName).toBe("Victim key");
  });

  it("PATCH with a blank deviceName -> 400", async () => {
    const owner = randomUUID();
    const cred = await seedCredential(owner);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/identity/webauthn/credentials/${cred.id}`,
      headers: headers(owner),
      payload: { deviceName: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH for a non-existent credential id -> 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/identity/webauthn/credentials/${randomUUID()}`,
      headers: headers(randomUUID()),
      payload: { deviceName: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});
