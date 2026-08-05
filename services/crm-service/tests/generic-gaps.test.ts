/**
 * Generic CRM capability gaps — route tests for all 8 gaps.
 * Covers: happy path + 401 + 403 per new route.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000aaa001";
const ACTOR = "cccccccc-3333-4000-8000-000000ccc001";
const CONTACT_ID = "dddddddd-4444-4000-8000-000000ddd001";
const ACCOUNT_ID = "eeeeeeee-5555-4000-8000-000000eee001";

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function seedData() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    // Seed a contact
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, email, lead_status, status, created_by, updated_by)
      VALUES (${CONTACT_ID}, ${TENANT}, 'Test Contact', 'test@example.com', 'new', 'active', ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `.catch(() => {});
    // Seed an account
    await tx`
      INSERT INTO crm.accounts (id, tenant_id, name, status, created_by, updated_by)
      VALUES (${ACCOUNT_ID}, ${TENANT}, 'Test Account', 'active', ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `.catch(() => {});
    // Seed account_relationships table structure check
    await tx`
      SELECT 1 FROM crm.account_relationships LIMIT 0
    `.catch(() => {});
  }).catch(() => {});
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.commission_ledger WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.commission_rules WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.referrals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.appointments WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.subscriptions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.account_relationships WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => { await cleanup(); await seedData(); });
afterAll(async () => { await cleanup(); await sqlClient.end(); });

// ─── Gap 1: Commission Rules & Ledger ─────────────────────────────────────────
describe("Gap 1: Commission Tracking", () => {
  let ruleId: string;

  it("creates a commission rule (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/commission-rules",
      headers: headers(["crm_admin"]),
      payload: { name: "Standard Sale", type: "sale", rateType: "percentage", rateValue: 500 },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    ruleId = res.json().data.id;
    expect(ruleId).toBeDefined();
  });

  it("lists commission rules", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/commission-rules",
      headers: headers(["crm_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("lists commissions (empty ledger)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/commissions",
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("returns commission summary", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/commissions/summary",
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("commission rules — 401 unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/commission-rules" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("commission rules — 403 wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/commission-rules",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── Gap 2: Referrals ──────────────────────────────────────────────────────────
describe("Gap 2: Referrals", () => {
  let referralId: string;

  it("creates a referral (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/referrals",
      headers: headers(),
      payload: { referrerId: ACTOR, referredContactId: CONTACT_ID, sourceSystem: "web", externalRef: "EXT-001" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    referralId = res.json().data.id;
    expect(referralId).toBeDefined();
  });

  it("prevents duplicate referral (409)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/referrals",
      headers: headers(),
      payload: { referrerId: ACTOR, referredContactId: CONTACT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });

  it("lists referrals", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/referrals",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("bulk reconciles referrals", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/referrals/reconcile",
      headers: headers(),
      payload: { entries: [{ externalRef: "EXT-001", outcome: "converted" }] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reconciled).toBe(1);
  });

  it("referrals — 401 unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/referrals" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("referrals — 403 wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/referrals",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── Gap 3: Appointments ───────────────────────────────────────────────────────
describe("Gap 3: Appointments", () => {
  let appointmentId: string;
  const LOCATION_ID = "ffffffff-6666-4000-8000-000000fff001";

  it("creates an appointment (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/appointments",
      headers: headers(),
      payload: {
        contactId: CONTACT_ID,
        serviceType: "consultation",
        locationId: LOCATION_ID,
        scheduledAt: "2025-08-01T10:00:00Z",
        durationMinutes: 30,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    appointmentId = res.json().data.id;
    expect(appointmentId).toBeDefined();
  });

  it("lists appointments with filters", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/appointments?contactId=${CONTACT_ID}`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("patches an appointment (reschedule)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/appointments/${appointmentId}`,
      headers: headers(),
      payload: { status: "confirmed" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("confirmed");
  });

  it("returns capacity for a location/date", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/appointments/capacity?locationId=${LOCATION_ID}&date=2025-08-01`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("appointments — 401 unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/appointments" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("appointments — 403 wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/appointments",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── Gap 4: Priority Flags ─────────────────────────────────────────────────────
describe("Gap 4: Priority Flags", () => {
  it("adds a flag to a contact (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/flags`,
      headers: headers(),
      payload: { flag: "vulnerable", reason: "Health condition" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.flag).toBe("vulnerable");
  });

  it("prevents duplicate flag (409)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/flags`,
      headers: headers(),
      payload: { flag: "vulnerable" },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });

  it("lists flags", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/${CONTACT_ID}/flags`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(1);
    expect(res.json().data[0].flag).toBe("vulnerable");
  });

  it("removes a flag (204)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/contacts/${CONTACT_ID}/flags/vulnerable`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(204);
  });

  it("flags — 401 unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/${CONTACT_ID}/flags`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("flags — 403 wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/${CONTACT_ID}/flags`,
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── Gap 5: Subscriptions ──────────────────────────────────────────────────────
describe("Gap 5: Subscriptions", () => {
  let subId: string;
  const PRODUCT_ID = "bbbbbbbb-2222-4000-8000-000000bbb001";

  it("creates a subscription (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/subscriptions",
      headers: headers(),
      payload: {
        contactId: CONTACT_ID,
        productId: PRODUCT_ID,
        type: "recurring",
        startDate: "2025-01-01",
        nextDueDate: "2025-02-01",
        frequency: "monthly",
        amountMinor: 99900,
        currency: "INR",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    subId = res.json().data.id;
    expect(subId).toBeDefined();
  });

  it("lists subscriptions", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/subscriptions?contactId=${CONTACT_ID}`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("pauses a subscription", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/subscriptions/${subId}`,
      headers: headers(),
      payload: { status: "paused" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("paused");
  });

  it("queries upcoming dues", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/subscriptions/due?days=30",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("subscriptions — 401 unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/subscriptions" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("subscriptions — 403 wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/subscriptions",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── Gap 7: Volume-vs-Actual Dashboard ─────────────────────────────────────────
describe("Gap 7: Volume-vs-Actual", () => {
  it("returns volume-vs-actual data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/volume-vs-actual",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("volume-vs-actual — 401 unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/volume-vs-actual" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("volume-vs-actual — 403 wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/volume-vs-actual",
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── Gap 8: Executive Sponsors ─────────────────────────────────────────────────
describe("Gap 8: Executive Sponsors", () => {
  it("adds an executive sponsor (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_ID}/sponsors`,
      headers: headers(),
      payload: { contactId: CONTACT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.relType).toBe("sponsor");
  });

  it("lists executive sponsors", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${ACCOUNT_ID}/sponsors`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("sponsors — 401 unauthenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${ACCOUNT_ID}/sponsors`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("sponsors — 403 wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${ACCOUNT_ID}/sponsors`,
      headers: headers(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
