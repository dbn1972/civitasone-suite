/**
 * check-in/routes.ts's synchronous POST /v1/visitor/passes/verify endpoint
 * used to hardcode watchlist screening off entirely (routes.ts, watchlist
 * block):
 *
 *   if (body.identityDocHash) {
 *     const blocked = await isBlacklisted(ctx.tenantId, body.identityDocHash);
 *     screening.blocked = blocked;
 *     if (!blocked) {
 *       // ...The screening-store only exports isBlacklisted. For watchlist
 *       // flagging at the gate, we rely on the domain layer's
 *       // `screening.flagged` field. A future enhancement could add
 *       // `isWatchlisted()` to screening-store.
 *       screening.flagged = false;
 *     }
 *   }
 *
 * That comment was stale: `isWatchlisted()` already existed on
 * blacklist/screening-store.ts and is used elsewhere in this very service
 * (check-in/consumer.ts, post-commit — see
 * check-in-watchlist-consumer-hash.test.ts for that path's own, independent
 * bug, covered separately). The synchronous verify endpoint — the real-time
 * gate response, Requirement 5.7 — never called it, so `watchlistFlagged` in
 * the verify response was unconditionally false no matter what was actually
 * on the watchlist.
 *
 * FIXED: routes.ts now calls `isWatchlisted(ctx.tenantId, body.identityDocHash)`
 * (same call shape as the existing `isBlacklisted` check right above it) and
 * assigns the real result to `screening.flagged`.
 *
 * Driven against the live app + DB (buildApp(), a real JWT, a real
 * watchlist-store entry). Only `verifyPassQr` is mocked, to stand in for
 * real RS256 QR signing/verification, which is orthogonal to this bug and
 * already covered by check-in/domain.ts's own Property 9 tests.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const LOCATION = randomUUID();
const GATE = randomUUID();
const RAW_DOC_REF = "AADHAAR-VERIFY-TEST-0001";
const DOC_TYPE = "aadhaar";

vi.mock("../src/shared/qr-crypto.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/qr-crypto.js")>("../src/shared/qr-crypto.js");
  return {
    ...actual,
    verifyPassQr: async () => ({
      visit_id: randomUUID(),
      visitor_id: randomUUID(),
      tenant_id: TENANT,
      location_id: LOCATION,
      valid_from: Math.floor(Date.now() / 1000) - 3600,
      valid_until: Math.floor(Date.now() / 1000) + 3600,
      permitted_areas: [],
      pass_type: "single",
      pass_number: "VP-TEST",
    }),
  };
});

const { signToken } = await import("@civitasone/auth");
const { sqlClient, db } = await import("../src/shared/db.js");
const { buildApp } = await import("../src/app.js");
const { locations, gates } = await import("../src/modules/location/schema.js");
const { addToWatchlistHashSet, setScreeningStoreForTests } = await import("../src/modules/blacklist/screening-store.js");
const { identityDocHash } = await import("../src/modules/blacklist/blind-index.js");

const WATCHLIST_HASH = identityDocHash(RAW_DOC_REF, DOC_TYPE);
const SECRET = process.env.JWT_SECRET as string;

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["security_admin"], sid: "sess-verify" }, SECRET, 3600)}` };
}

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION, tenantId: TENANT, name: "Verify Gate Location",
        businessHours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
        rsaPublicKey: "not-cryptographically-used-verifyPassQr-is-mocked",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(gates).values({
        id: GATE, tenantId: TENANT, locationId: LOCATION, name: "Main Gate",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }),
  );
  // Seed a REAL watchlist screening-store entry for this exact hash — proves
  // the miss below is not "nothing is on the watchlist," it is "the
  // endpoint never asks."
  await addToWatchlistHashSet(TENANT, WATCHLIST_HASH);
});

afterAll(async () => {
  setScreeningStoreForTests(null);
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(gates).where(eq(gates.id, GATE));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
  await sqlClient.end();
});

describe("POST /v1/visitor/passes/verify — watchlist screening (FIXED)", () => {
  it("returns watchlistFlagged: true for a presented identityDocHash that IS on the watchlist", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/passes/verify",
      headers: authHeader(),
      payload: { qrToken: "mocked", gateId: GATE, identityDocHash: WATCHLIST_HASH },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.watchlistFlagged).toBe(true);
  });

  it("negative control: returns watchlistFlagged: false for an identityDocHash that is NOT on the watchlist — proves the fix actually checks the store rather than hardcoding true", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/passes/verify",
      headers: authHeader(),
      payload: { qrToken: "mocked", gateId: GATE, identityDocHash: identityDocHash("NOT-WATCHLISTED-9999", DOC_TYPE) },
    });
    await app.close();

    const body = res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.watchlistFlagged).toBe(false);
  });
});

describe("what SHOULD happen (FIXED)", () => {
  it("a watchlisted identityDocHash is surfaced as watchlistFlagged: true in the verify response", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/passes/verify",
      headers: authHeader(),
      payload: { qrToken: "mocked", gateId: GATE, identityDocHash: WATCHLIST_HASH },
    });
    await app.close();

    const body = res.json();
    expect(body.data.watchlistFlagged).toBe(true);
  });
});
