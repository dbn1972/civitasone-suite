/**
 * Lead conversion tests (OP-001).
 * Tests POST /v1/crm/leads/:id/convert — happy path, invalid status, missing fields.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000030";
const ACTOR = "cccccccc-3333-4000-8000-000000000030";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-conversion" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const QUALIFIED_LEAD_ID = "44444444-dddd-4000-8000-000000000001";
const NEW_LEAD_ID = "44444444-dddd-4000-8000-000000000002";
const CONVERTED_LEAD_ID = "44444444-dddd-4000-8000-000000000003";
const INACTIVE_LEAD_ID = "44444444-dddd-4000-8000-000000000004";
const NONEXIST_ID = "ffffffff-ffff-4000-8000-000000000099";

async function seedLeads(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${QUALIFIED_LEAD_ID}, ${TENANT}, 'Qualified Lead', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${NEW_LEAD_ID}, ${TENANT}, 'New Lead', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${CONVERTED_LEAD_ID}, ${TENANT}, 'Converted Lead', 'converted', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${INACTIVE_LEAD_ID}, ${TENANT}, 'Inactive Lead', 'qualified', 'inactive', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

beforeAll(async () => {
  await cleanup();
  await seedLeads();
});

describe("POST /v1/crm/leads/:id/convert", () => {
  describe("happy path", () => {
    it("converts qualified lead with account creation → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: {
          createAccount: true,
          accountName: "New Account Corp",
          dealName: "New Deal",
          dealValue: "500000",
        },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
      expect(body.correlationId).toBeDefined();
    });

    it("converts qualified lead without account creation → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("converts 'converted' status lead → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${CONVERTED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("converts with deal name but no value → 202", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false, dealName: "Side Deal" },
      });
      await app.close();
      expect(res.statusCode).toBe(202);
    });
  });

  describe("invalid status (422)", () => {
    it("rejects conversion of 'new' lead → 422", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${NEW_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe("INVALID_STATUS");
    });
  });

  describe("not found (404)", () => {
    it("returns 404 for non-existent lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${NONEXIST_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for inactive lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${INACTIVE_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });
  });

  describe("validation errors (400)", () => {
    it("rejects createAccount=true without accountName → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: { createAccount: true },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects missing createAccount field → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: headers(),
        payload: {},
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid UUID in path → 400", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/not-a-uuid/convert`,
        headers: headers(),
        payload: { createAccount: false },
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
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: `/v1/crm/leads/${QUALIFIED_LEAD_ID}/convert`,
        headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
        payload: { createAccount: false },
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });
  });
});
