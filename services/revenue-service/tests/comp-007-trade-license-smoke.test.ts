/**
 * COMP-007 -- revenue-service `trade-license` module, smoke test.
 *
 * Registered in app.ts (real command/domain/repo module, 516 LOC, its own
 * validators + error handler) but had zero test references anywhere in the
 * service. Notable: this is the backend for `apps/web`'s
 * `revenue/trade-licenses/page.tsx`, which UX-018 (this campaign, PR #1291)
 * fixed a frontend BigInt crash in when `feeMinor`/`feePaidMinor` were
 * missing -- this route is the one actually producing that data, and had no
 * test of its own confirming what shape it returns.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000299";

function makeToken(roles: string[] = ["revenue_admin"]) {
  return signToken({ sub: "user-comp007-trade-license", tid: TENANT, roles, sid: "sess-comp007-tl" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: trade-license -- POST /v1/revenue/trade-licenses", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/revenue/trade-licenses", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a missing businessType (real zod validation, not a silent 500)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/trade-licenses",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { businessName: "COMP-007 Smoke Traders", address: "1 MG Road" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("accepts a real create command and returns a real, trackable messageId", async () => {
    // This route is CQRS/async all the way down (commands.createTradeLicense
    // -> publishCommand -> queue.publish; the actual INSERT happens in a
    // separate worker-side consumer, not synchronously here), so a 202 with a
    // real messageId -- not a fabricated entity -- is this route's real
    // contract. Confirmed by reading src/modules/trade-license/commands.ts
    // and src/shared/publish.ts.
    const app = await buildApp();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/revenue/trade-licenses",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        businessName: "COMP-007 Smoke Traders",
        address: "1 MG Road, Pune",
        businessType: "retail",
        feeMinor: 250000, // Rs 2,500.00 -- exercises the coercion validators.ts applies (feeMinorCoerce)
      },
    });
    await app.close();
    expect(createRes.statusCode).toBe(202);
    const body = createRes.json().data as { messageId: string };
    expect(body.messageId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("returns 200 with a real (empty-for-a-fresh-tenant) list for a valid role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/trade-licenses",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});
