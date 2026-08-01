/**
 * Deal close tests (OP-006).
 * Tests POST /v1/crm/deals/:id/close — won/lost, missing reason, validation.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000040";
const ACTOR = "cccccccc-3333-4000-8000-000000000040";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-close" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const OPEN_DEAL_ID = "55555555-eeee-4000-8000-000000000001";
const WON_DEAL_ID = "55555555-eeee-4000-8000-000000000002";
const LOST_DEAL_ID = "55555555-eeee-4000-8000-000000000003";
const PROPOSAL_DEAL_ID = "55555555-eeee-4000-8000-000000000004";
const NONEXIST_ID = "ffffffff-ffff-4000-8000-000000000099";

async function seedDeals(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${OPEN_DEAL_ID}, ${TENANT}, 'Open Deal', 'Negotiation', 100000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${WON_DEAL_ID}, ${TENANT}, 'Won Deal', 'Won', 200000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${LOST_DEAL_ID}, ${TENANT}, 'Lost Deal', 'Lost', 50000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${PROPOSAL_DEAL_ID}, ${TENANT}, 'Proposal Deal', 'Proposal', 75000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

beforeAll(async () => {
  await cleanup();
  await seedDeals();
});

describe("POST /v1/crm/deals/:id/close", () => {
  describe("happy path — won", () => {
    it("closes deal as won → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won", reason: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
    });

    it("closes deal as won with closedValue → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${PROPOSAL_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won", closedValue: "150000" },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("won does not require reason", async () => {
      // Re-seed the deal to be open again
      await sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        await tx`UPDATE crm.deals SET stage = 'Negotiation' WHERE id = ${OPEN_DEAL_ID}`;
      });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(202);
    });
  });

  describe("happy path — lost", () => {
    it("closes deal as lost with valid reason → 202", async () => {
      // Re-seed to open
      await sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        await tx`UPDATE crm.deals SET stage = 'Negotiation' WHERE id = ${OPEN_DEAL_ID}`;
      });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "Budget was cut by the client organization" },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });
  });

  describe("missing/short reason for lost (400)", () => {
    it("rejects lost without reason → 400", async () => {
      await sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
        await tx`UPDATE crm.deals SET stage = 'Negotiation' WHERE id = ${OPEN_DEAL_ID}`;
      });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("REASON_REQUIRED");
    });

    it("rejects lost with short reason (< 10 chars) → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "budget" },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("REASON_REQUIRED");
    });

    it("rejects lost with whitespace-only reason → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "          " },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  });

  describe("already closed (422)", () => {
    it("rejects closing an already won deal → 422", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${WON_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "lost", reason: "Trying to close again for some reason" },
      });
      await app.close();
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("ALREADY_CLOSED");
    });

    it("rejects closing an already lost deal → 422", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${LOST_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(422);
    });
  });

  describe("not found (404)", () => {
    it("returns 404 for non-existent deal", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${NONEXIST_ID}/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });
  });

  describe("validation (400)", () => {
    it("rejects invalid outcome → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: headers(),
        payload: { outcome: "draw" },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid UUID in path → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/not-a-uuid/close`,
        headers: headers(),
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  });

  describe("auth", () => {
    it("returns 401 without token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/deals/${OPEN_DEAL_ID}/close`,
        headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
        payload: { outcome: "won" },
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });
  });
});
