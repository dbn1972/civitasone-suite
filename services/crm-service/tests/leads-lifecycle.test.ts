/**
 * Lead lifecycle transition tests (LQ-004).
 *
 * Tests the POST /v1/crm/leads/:id/transition route (state machine validation,
 * mandatory reason enforcement, auth/authz) and the lifecycle consumer.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000003";
const ACTOR = "cccccccc-3333-4000-8000-000000000003";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-lifecycle" }, SECRET);
}

/** Headers with auth token + tenant header for RLS-aware queries */
function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

afterAll(async () => { await sqlClient.end(); });

// Helper to seed a contact for transition tests — uses BEGIN + SET LOCAL
// so RLS allows the INSERT on the tenant-scoped table.
async function seedContact(id: string, leadStatus: string): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'Test Lead', ${leadStatus}, 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO UPDATE SET lead_status = ${leadStatus}, version = crm.contacts.version + 1
    `;
  });
}

async function cleanupContact(id: string): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.lead_transitions WHERE contact_id = ${id}`.catch(() => { /* table may not exist */ });
    await tx`DELETE FROM crm.contacts WHERE id = ${id}`.catch(() => { /* best-effort */ });
  }).catch(() => { /* best-effort cleanup */ });
}

const LEAD_ID_1 = "eeeeeeee-5555-4000-8000-000000000001";
const LEAD_ID_2 = "eeeeeeee-5555-4000-8000-000000000002";
const LEAD_ID_3 = "eeeeeeee-5555-4000-8000-000000000003";
const LEAD_ID_4 = "eeeeeeee-5555-4000-8000-000000000004";
const NONEXIST_ID = "ffffffff-6666-4000-8000-000000000099";

describe("POST /v1/crm/leads/:id/transition", () => {
  describe("valid transitions (happy path)", () => {
    it("new → qualified (no reason required)", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "qualified", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.status).toBe("accepted");
      expect(body.id).toBeDefined();
    });

    it("new → nurture (reason required, provided)", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_2, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_2}/transition`,
        headers: headers(),
        payload: {
          targetStatus: "nurture",
          reason: "Not ready to purchase yet, needs more education on the product",
        },
      });

      await cleanupContact(LEAD_ID_2);
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("new → disqualified (reason required, provided)", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_3, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_3}/transition`,
        headers: headers(),
        payload: {
          targetStatus: "disqualified",
          reason: "Duplicate entry — already exists as another contact",
        },
      });

      await cleanupContact(LEAD_ID_3);
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("qualified → recycled (reason required, provided)", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_4, "qualified");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_4}/transition`,
        headers: headers(),
        payload: {
          targetStatus: "recycled",
          reason: "Budget was not approved, returning to the pool for re-engagement later",
        },
      });

      await cleanupContact(LEAD_ID_4);
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("qualified → converted", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "qualified");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "converted", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("nurture → qualified", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "nurture");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "qualified", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("recycled → qualified", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "recycled");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "qualified", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("recycled → nurture (reason required, provided)", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "recycled");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: {
          targetStatus: "nurture",
          reason: "Lead showing renewed interest after recent webinar attendance",
        },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(202);
    });
  });

  describe("invalid transitions (422)", () => {
    it("new → converted is invalid", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "converted", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe("INVALID_TRANSITION");
    });

    it("new → recycled is invalid", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: {
          targetStatus: "recycled",
          reason: "Some reason that is long enough to pass validation",
        },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(422);
    });

    it("nurture → recycled is invalid", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "nurture");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: {
          targetStatus: "recycled",
          reason: "Attempting an invalid transition path here",
        },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(422);
    });

    it("converted → anything is invalid (terminal state)", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "converted");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "qualified", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(422);
    });
  });

  describe("mandatory reason validation (400)", () => {
    it("nurture target with missing reason → 400", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "nurture", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("REASON_REQUIRED");
    });

    it("disqualified target with short reason (< 10 chars) → 400", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "disqualified", reason: "short" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("REASON_REQUIRED");
    });

    it("recycled target with whitespace-only reason → 400", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "qualified");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "recycled", reason: "         " },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("qualified target without reason is fine", async () => {
      const app = await buildApp();
      await seedContact(LEAD_ID_1, "new");

      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: headers(),
        payload: { targetStatus: "qualified", reason: "" },
      });

      await cleanupContact(LEAD_ID_1);
      await app.close();

      expect(res.statusCode).toBe(202);
    });
  });

  describe("not found (404)", () => {
    it("returns 404 for non-existent lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${NONEXIST_ID}/transition`,
        headers: headers(),
        payload: { targetStatus: "qualified", reason: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  describe("authentication (401)", () => {
    it("returns 401 without token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        payload: { targetStatus: "qualified", reason: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });
  });

  describe("authorization (403)", () => {
    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${LEAD_ID_1}/transition`,
        headers: { authorization: `Bearer ${token(["citizen"])}` },
        payload: { targetStatus: "qualified", reason: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });
  });
});

describe("lifecycle consumer (unit)", () => {
  it("registerLifecycleConsumer subscribes to correct topic", async () => {
    const { registerLifecycleConsumer } = await import("../src/modules/leads/lifecycle-consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const subscriptions: string[] = [];
    const mockQueue = {
      subscribe: (topic: string, _handler: unknown) => { subscriptions.push(topic); },
      publish: vi.fn(),
    };

    registerLifecycleConsumer(mockQueue as never);
    expect(subscriptions).toContain(COMMANDS.leadTransition);
  });
});
