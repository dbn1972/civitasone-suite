/**
 * SEC-007 — SCIM per-tenant token isolation.
 *
 * Pre-fix, identity-service/src/modules/scim/routes.ts took the tenant for
 * every SCIM operation from the client-supplied x-tenant-id header (falling
 * back to SCIM_TENANT_ID, then a hardcoded default) while authenticating
 * against ONE global SCIM_BEARER_TOKEN shared by every tenant. Anyone
 * holding that one token could read/create/update/delete users in ANY
 * tenant simply by setting a different header value.
 *
 * Post-fix, every SCIM route resolves its tenant SOLELY from the presented
 * bearer token (resolveScimTenant in routes.ts), which is bound to exactly
 * one tenant server-side in scim.scim_tokens at issuance. The x-tenant-id
 * header plays no role in that decision.
 *
 * GROUP 1 is written to be the sabotage-check vehicle: it authenticates
 * with the SAME legacy SCIM_BEARER_TOKEN / SCIM_TENANT_ID env-var
 * credential every other SCIM test file already relies on (see
 * vitest.config.ts). bootstrapLegacyScimToken (routes.ts) binds that
 * credential to SCIM_TENANT_ID regardless of which routes.ts is checked
 * out, so these exact requests are meaningful evidence either way:
 *   - against the PRE-FIX routes.ts (git show HEAD~N or the original diff),
 *     the x-tenant-id header picks the tenant directly, so pointing it at
 *     VICTIM_TENANT succeeds and touches the victim's data — reproducing
 *     the vulnerability;
 *   - against the CURRENT routes.ts, the header is ignored, the request
 *     stays confined to SCIM_TENANT_ID, and the exact same requests
 *     404/miss instead.
 *
 * GROUP 2 proves the new per-tenant issuance path (POST
 * /identity/scim-tokens) produces tokens that are equally isolated from
 * each other, and that revocation takes effect immediately.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { db } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET as string;
const LEGACY_TOKEN = process.env.SCIM_BEARER_TOKEN as string; // bound to LEGACY_TENANT by bootstrapLegacyScimToken
const LEGACY_TENANT = process.env.SCIM_TENANT_ID as string;
const VICTIM_TENANT = "b7000000-0000-4000-8000-000000000b07"; // never configured as anyone's SCIM tenant
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

function internalHeaders(bearerToken: string, tenantHeader: string): Record<string, string> {
  // authPlugin's x-internal branch requires a non-empty x-tenant-id to even
  // engage (see packages/auth/src/plugin.ts) — every SCIM x-internal test in
  // this suite (scim-internal.test.ts included) always sends one. Here it
  // doubles as the ATTACK vector: the value this header carries is exactly
  // what pre-fix code trusted as the operation's tenant.
  return {
    "x-internal": "1",
    "x-service-secret": INTERNAL_SECRET,
    "x-tenant-id": tenantHeader,
    authorization: `Bearer ${bearerToken}`,
  };
}

function adminJwt(tenantId: string): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["super_admin"], sid: "s1" } as never, SECRET);
}
const adminHeaders = (tenantId: string) => ({ authorization: `Bearer ${adminJwt(tenantId)}` });

async function seedUser(id: string, tenantId: string, email: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values({ id, tenantId, email, name: "Victim User", status: "active", createdBy: ACTOR, updatedBy: ACTOR })
        .onConflictDoNothing();
    }),
  );
}

async function readUser(tenantId: string, id: string) {
  const [row] = await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => tx.select().from(users).where(eq(users.id, id))),
  );
  return row;
}

let app: FastifyInstance;
let queue: MemoryQueue;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();

  // Same wiring as scim-internal.test.ts: register the real SCIM consumer
  // against the shared queue so POST/PUT/PATCH/DELETE's F3 async writes
  // actually land, tenant-wrapped so RLS lets the insert/update through.
  const { queue: sharedQueue } = await import("../src/shared/infra.js");
  const { registerScimConsumers } = await import("../src/modules/scim/consumer.js");
  const rawSubscribe = sharedQueue.subscribe.bind(sharedQueue);
  sharedQueue.subscribe = ((topic: string, handler: Parameters<typeof rawSubscribe>[1]) =>
    rawSubscribe(topic, withTenantConsumer(handler))) as typeof sharedQueue.subscribe;
  registerScimConsumers(sharedQueue);
  await sharedQueue.start();
  queue = sharedQueue as unknown as MemoryQueue;
});
afterAll(async () => {
  await app.close();
});

describe("SEC-007 — legacy env-configured SCIM token cannot cross tenants (sabotage-check vehicle)", () => {
  const VICTIM_USER = "b7000000-0000-4000-8000-0000000000f1";

  it("setup: seed a victim user directly in a tenant the legacy token is NOT bound to", async () => {
    await seedUser(VICTIM_USER, VICTIM_TENANT, "victim@other-tenant.gov.in");
    expect(await readUser(VICTIM_TENANT, VICTIM_USER)).toBeTruthy();
  });

  it("GET /Users/:id — legacy token + x-tenant-id spoofed as the victim tenant does not see the victim", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/identity/scim/Users/${VICTIM_USER}`,
      headers: internalHeaders(LEGACY_TOKEN, VICTIM_TENANT),
    });
    // Pre-fix: 200 with the victim's SCIM representation (header picked the tenant).
    // Post-fix: the token is bound to LEGACY_TENANT regardless of the header, so
    // a user that only exists in VICTIM_TENANT is invisible.
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /Users/:id — legacy token + spoofed x-tenant-id cannot deprovision the victim", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/identity/scim/Users/${VICTIM_USER}`,
      headers: internalHeaders(LEGACY_TOKEN, VICTIM_TENANT),
    });
    expect(res.statusCode).toBe(404);
    await queue.drain();
    const victim = await readUser(VICTIM_TENANT, VICTIM_USER);
    expect(victim?.status).toBe("active"); // untouched — NOT soft-deleted
  });

  it("PATCH /Users/:id — legacy token + spoofed x-tenant-id cannot disable the victim", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/identity/scim/Users/${VICTIM_USER}`,
      headers: internalHeaders(LEGACY_TOKEN, VICTIM_TENANT),
      payload: { Operations: [{ op: "replace", path: "active", value: false }] },
    });
    expect(res.statusCode).toBe(404);
    await queue.drain();
    const victim = await readUser(VICTIM_TENANT, VICTIM_USER);
    expect(victim?.status).toBe("active");
  });

  it("POST /Users — legacy token + spoofed x-tenant-id creates the user in the TOKEN's tenant, never the header's", async () => {
    const email = `sec007-spoofed-${Date.now()}@coverage.gov.in`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/scim/Users",
      headers: internalHeaders(LEGACY_TOKEN, VICTIM_TENANT),
      payload: { userName: email, name: { givenName: "Spoofed", familyName: "Header" } },
    });
    expect(res.statusCode).toBe(202);
    const createdId = res.json().id as string;
    await queue.drain();

    expect(await readUser(VICTIM_TENANT, createdId)).toBeUndefined(); // did NOT land in the spoofed tenant
    const inLegacyTenant = await readUser(LEGACY_TENANT, createdId);
    expect(inLegacyTenant?.email).toBe(email); // landed in the token's real (bound) tenant instead
  });

  it("control: legacy token + its OWN matching x-tenant-id still works normally", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/identity/scim/Users",
      headers: internalHeaders(LEGACY_TOKEN, LEGACY_TENANT),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().Resources).toBeInstanceOf(Array);
  });
});

describe("SEC-007 — freshly issued per-tenant SCIM tokens are isolated from each other", () => {
  const TENANT_C = "c7000000-0000-4000-8000-000000000c01";
  const TENANT_D = "d7000000-0000-4000-8000-000000000d02";
  let tokenC: string;
  let tokenD: string;
  let tokenCId: string;
  let tokenDId: string;
  let userDId: string;

  it("issue one token per tenant via the new admin route", async () => {
    const resC = await app.inject({
      method: "POST",
      url: "/identity/scim-tokens",
      headers: adminHeaders(TENANT_C),
      payload: { name: "okta-connector" },
    });
    expect(resC.statusCode).toBe(201);
    tokenC = resC.json().token;
    tokenCId = resC.json().id;

    const resD = await app.inject({
      method: "POST",
      url: "/identity/scim-tokens",
      headers: adminHeaders(TENANT_D),
      payload: { name: "azuread-connector" },
    });
    expect(resD.statusCode).toBe(201);
    tokenD = resD.json().token;
    tokenDId = resD.json().id;

    expect(tokenC).not.toBe(tokenD);
  });

  it("an admin can only ever list tokens for their own tenant", async () => {
    const res = await app.inject({ method: "GET", url: "/identity/scim-tokens", headers: adminHeaders(TENANT_C) });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    // Robust to re-runs against a persistent dev DB (which may already hold
    // other tenant-C tokens from earlier local runs): the property that
    // actually matters is that tenant D's token id never appears in tenant
    // C's own listing, not an exact row count.
    expect(rows.map((r) => r.id)).toContain(tokenCId);
    expect(rows.map((r) => r.id)).not.toContain(tokenDId);
  });

  it("seed a user in tenant D using tenant D's own freshly issued token", async () => {
    const email = `sec007-tenantd-${Date.now()}@coverage.gov.in`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/scim/Users",
      headers: internalHeaders(tokenD, TENANT_D),
      payload: { userName: email, name: { givenName: "Tenant", familyName: "D" } },
    });
    expect(res.statusCode).toBe(202);
    userDId = res.json().id as string;
    await queue.drain();
    expect(await readUser(TENANT_D, userDId)).toBeTruthy();
  });

  it("tenant C's token + x-tenant-id spoofed as tenant D cannot read tenant D's user", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/identity/scim/Users/${userDId}`,
      headers: internalHeaders(tokenC, TENANT_D),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant C's token + x-tenant-id spoofed as tenant D cannot delete tenant D's user", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/identity/scim/Users/${userDId}`,
      headers: internalHeaders(tokenC, TENANT_D),
    });
    expect(res.statusCode).toBe(404);
    await queue.drain();
    const row = await readUser(TENANT_D, userDId);
    expect(row?.status).toBe("active"); // untouched
  });

  it("tenant D's own token still works correctly for tenant D", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/identity/scim/Users/${userDId}`,
      headers: internalHeaders(tokenD, TENANT_D),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(userDId);
  });

  it("a revoked token is rejected outright, header or no", async () => {
    await app.inject({
      method: "POST",
      url: `/identity/scim-tokens/${tokenCId}/revoke`,
      headers: adminHeaders(TENANT_C),
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/identity/scim/Users",
      headers: internalHeaders(tokenC, TENANT_C),
    });
    expect(res.statusCode).toBe(401);
  });
});
