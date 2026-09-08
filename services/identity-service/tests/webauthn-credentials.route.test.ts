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
