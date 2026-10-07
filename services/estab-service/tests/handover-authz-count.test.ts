/**
 * GAP-ESTAB-HANDOVER-02/03 backend tests.
 *
 * HANDOVER-02: POST /v1/estab/handovers enforces ADMIN_ROLES — a plain
 * estab_officer must receive 403.
 *
 * HANDOVER-03: GET /v1/estab/files/held-count returns the non-terminal file
 * count on a specific officer's desk, used by the charge-handover confirm
 * dialog's blast-radius preview.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[], sub = "user-001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── HANDOVER-02: POST /v1/estab/handovers requires admin role ────────────

describe("POST /v1/estab/handovers — authz gate (HANDOVER-02)", () => {
  it("returns 403 for a plain estab_officer (not an admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/handovers",
      headers: {
        authorization: `Bearer ${makeToken(["estab_officer"])}`,
        "content-type": "application/json",
      },
      payload: {
        fromOfficerId: randomUUID(),
        toOfficerId: randomUUID(),
        reason: "transfer",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 202 (or 422 for unknown operator) for an estab_division_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/handovers",
      headers: {
        authorization: `Bearer ${makeToken(["estab_division_admin"])}`,
        "content-type": "application/json",
      },
      payload: {
        fromOfficerId: randomUUID(),
        toOfficerId: randomUUID(),
        reason: "transfer",
      },
    });
    await app.close();
    // 202 if operators not adopted, 422 if adopted but unknown — either is not 403.
    expect([202, 422]).toContain(res.statusCode);
  });
});

// ── HANDOVER-03: GET /v1/estab/files/held-count ──────────────────────────
describe("GET /v1/estab/files/held-count (HANDOVER-03)", () => {
  it("returns { officerId, count } with a number", async () => {
    const officerId = randomUUID();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/held-count?officerId=${officerId}`,
      headers: { authorization: `Bearer ${makeToken(["estab_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.count).toBe("number");
    expect(body.count).toBe(0); // unknown officer → 0 files
  });

  it("returns 400 on invalid officerId (non-UUID)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/files/held-count?officerId=not-a-uuid",
      headers: { authorization: `Bearer ${makeToken(["estab_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/held-count?officerId=${randomUUID()}`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── INBOX-01: GET /v1/estab/files/mine — My Desk ─────────────────────────

describe("GET /v1/estab/files/mine (INBOX-01)", () => {
  it("returns 200 with a data array for an authenticated estab_officer", async () => {
    const app = await buildApp();
    // Use a UUID sub because currentWith is a uuid column.
    const sub = "eeeeeeee-0001-4000-8000-000000000099";
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/files/mine",
      headers: { authorization: `Bearer ${makeToken(["estab_officer"], sub)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.actorId).toBe("string");
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/files/mine",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
