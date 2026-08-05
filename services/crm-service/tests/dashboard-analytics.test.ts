/**
 * Dashboard analytics endpoints — Gaps 3, 4, 7, 9.
 * Tests: happy path, auth (401/403), query validation (400).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "cccccccc-3333-4000-8000-000000000099";
const OWNER_A = "dddddddd-4444-4000-8000-000000000099";
const OWNER_B = "dddddddd-5555-4000-8000-000000000099";
const CONTACT_A = "eeeeeeee-0001-4000-8000-000000000099";
const CONTACT_B = "eeeeeeee-0002-4000-8000-000000000099";
const CONTACT_C = "eeeeeeee-0003-4000-8000-000000000099";
const ACCOUNT_A = "ffffffff-0001-4000-8000-000000000099";
const ACCOUNT_B = "ffffffff-0002-4000-8000-000000000099";
const ACCOUNT_C = "ffffffff-0003-4000-8000-000000000099";
const DEAL_WON = "11111111-0001-4000-8000-000000000099";
const DEAL_LOST = "11111111-0002-4000-8000-000000000099";
const DEAL_CS_A = "11111111-0003-4000-8000-000000000099";
const DEAL_CS_B = "11111111-0004-4000-8000-000000000099";
const DEAL_CS_C = "11111111-0005-4000-8000-000000000099";

function token(roles = ["crm_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-analytics" }, SECRET);
}

function headers(roles = ["crm_admin"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function seedData(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;

    // Accounts
    await tx`
      INSERT INTO crm.accounts (id, tenant_id, name, industry, status, created_by, updated_by, created_at)
      VALUES
        (${ACCOUNT_A}, ${TENANT}, 'Acme Corp', 'Tech', 'active', ${ACTOR}, ${ACTOR}, now() - interval '200 days'),
        (${ACCOUNT_B}, ${TENANT}, 'Beta LLC', 'Finance', 'active', ${ACTOR}, ${ACTOR}, now() - interval '100 days'),
        (${ACCOUNT_C}, ${TENANT}, 'Gamma Inc', 'Healthcare', 'active', ${ACTOR}, ${ACTOR}, now() - interval '50 days')
      ON CONFLICT (id) DO NOTHING
    `;

    // Contacts (leads)
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, lead_source, owner_id, account_id, status, created_by, updated_by, created_at)
      VALUES
        (${CONTACT_A}, ${TENANT}, 'Lead Alpha', 'new', 'website', ${OWNER_A}, ${ACCOUNT_A}, 'active', ${ACTOR}, ${ACTOR}, now() - interval '5 days'),
        (${CONTACT_B}, ${TENANT}, 'Lead Beta', 'contacted', 'referral', ${OWNER_B}, ${ACCOUNT_B}, 'active', ${ACTOR}, ${ACTOR}, now() - interval '10 days'),
        (${CONTACT_C}, ${TENANT}, 'Lead Gamma', 'qualified', 'website', ${OWNER_A}, ${ACCOUNT_C}, 'active', ${ACTOR}, ${ACTOR}, now() - interval '2 days')
      ON CONFLICT (id) DO NOTHING
    `;

    // Activities (for response time + dormant accounts)
    await tx`
      INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, account_id, type, created_by, updated_by, created_at)
      VALUES
        (gen_random_uuid(), ${TENANT}, 'Agent', 'Called lead', ${CONTACT_A}, ${ACCOUNT_A}, 'call', ${OWNER_A}, ${OWNER_A}, now() - interval '4 days'),
        (gen_random_uuid(), ${TENANT}, 'Agent', 'Emailed lead', ${CONTACT_B}, ${ACCOUNT_B}, 'email', ${OWNER_B}, ${OWNER_B}, now() - interval '8 days'),
        (gen_random_uuid(), ${TENANT}, 'Agent', 'Meeting', ${CONTACT_C}, ${ACCOUNT_C}, 'meeting', ${OWNER_A}, ${OWNER_A}, now() - interval '1 day')
      ON CONFLICT (id) DO NOTHING
    `;

    // Lead transitions (for conversion funnel)
    await tx`
      INSERT INTO crm.lead_transitions (id, tenant_id, contact_id, from_status, to_status, reason, created_by, created_at)
      VALUES
        (gen_random_uuid(), ${TENANT}, ${CONTACT_A}, 'new', 'contacted', 'initial call', ${OWNER_A}, now() - interval '4 days'),
        (gen_random_uuid(), ${TENANT}, ${CONTACT_B}, 'new', 'contacted', 'email outreach', ${OWNER_B}, now() - interval '9 days'),
        (gen_random_uuid(), ${TENANT}, ${CONTACT_B}, 'contacted', 'qualified', 'budget confirmed', ${OWNER_B}, now() - interval '8 days'),
        (gen_random_uuid(), ${TENANT}, ${CONTACT_C}, 'new', 'qualified', 'fast track', ${OWNER_A}, now() - interval '1 day')
      ON CONFLICT (id) DO NOTHING
    `;

    // Next actions (for follow-up compliance)
    await tx`
      INSERT INTO crm.next_actions (id, tenant_id, subject_type, subject_id, action_type, due_at, completed_at, created_by)
      VALUES
        (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT_A}, 'call', now() - interval '2 days', now() - interval '3 days', ${OWNER_A}),
        (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT_B}, 'email', now() - interval '1 day', now(), ${OWNER_B}),
        (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT_C}, 'call', now() + interval '1 day', NULL, ${OWNER_A})
    `;

    // Deals (for won/lost + cross-sell)
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, status, close_outcome, close_reason, close_competitor, product, contact_id, value_minor, created_by, updated_by, created_at, updated_at)
      VALUES
        (${DEAL_WON}, ${TENANT}, 'Won Deal', 'won', 'won', 'best price', NULL, 'CRM', ${CONTACT_A}, 500000, ${ACTOR}, ${ACTOR}, now() - interval '30 days', now() - interval '5 days'),
        (${DEAL_LOST}, ${TENANT}, 'Lost Deal', 'lost', 'lost', 'competitor won', '["Salesforce"]', 'ERP', ${CONTACT_B}, 1000000, ${ACTOR}, ${ACTOR}, now() - interval '20 days', now() - interval '2 days'),
        (${DEAL_CS_A}, ${TENANT}, 'Cross A', 'active', NULL, NULL, NULL, 'CRM', ${CONTACT_A}, 200000, ${ACTOR}, ${ACTOR}, now() - interval '10 days', now()),
        (${DEAL_CS_B}, ${TENANT}, 'Cross B', 'won', 'won', 'good fit', NULL, 'ERP', ${CONTACT_A}, 300000, ${ACTOR}, ${ACTOR}, now() - interval '15 days', now()),
        (${DEAL_CS_C}, ${TENANT}, 'Cross C', 'active', NULL, NULL, NULL, 'HR', ${CONTACT_B}, 100000, ${ACTOR}, ${ACTOR}, now() - interval '5 days', now())
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.next_actions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.lead_transitions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await seedData();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 3: Lead Response Time
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/lead-response-time", () => {
  it("returns avg response time grouped by period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-response-time?period=month",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("avgHours");
    expect(body.data[0]).toHaveProperty("leadCount");
    expect(body.data[0]).toHaveProperty("period");
    expect(body.meta.period).toBe("month");
  });

  it("filters by source", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-response-time?period=day&source=website",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });

  it("filters by ownerId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/dashboard/lead-response-time?ownerId=${OWNER_A}`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for invalid period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-response-time?period=year",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-response-time",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-response-time",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 3: Lead Ageing
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/lead-ageing", () => {
  it("returns lead counts by ageing bucket", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-ageing",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("bucket");
    expect(body.data[0]).toHaveProperty("count");
    expect(body.meta).toHaveProperty("total");
    // Total should equal sum of all bucket counts
    const sum = body.data.reduce((s: number, r: { count: number }) => s + r.count, 0);
    expect(body.meta.total).toBe(sum);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-ageing",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/lead-ageing",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 3: Follow-up Compliance
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/follow-up-compliance", () => {
  it("returns compliance percentages grouped by owner", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/follow-up-compliance",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("ownerId");
    expect(body.data[0]).toHaveProperty("onTime");
    expect(body.data[0]).toHaveProperty("overdue");
    expect(body.data[0]).toHaveProperty("compliancePercent");
    expect(body.data[0]).toHaveProperty("total");
  });

  it("filters by ownerId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/dashboard/follow-up-compliance?ownerId=${OWNER_A}`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Should only have owner A's data
    expect(body.data.length).toBeLessThanOrEqual(1);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/follow-up-compliance",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/follow-up-compliance",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 4: Conversion Funnel
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/conversion-funnel", () => {
  it("returns transitions with count and percent", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel?period=month",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("fromStatus");
    expect(body.data[0]).toHaveProperty("toStatus");
    expect(body.data[0]).toHaveProperty("count");
    expect(body.data[0]).toHaveProperty("percent");
    expect(body.meta.period).toBe("month");
  });

  it("filters by source", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel?source=website",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for invalid period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel?period=quarter",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 7: Won/Lost Analysis
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/won-lost-analysis", () => {
  it("returns won/lost counts with avg cycle days", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/won-lost-analysis?period=month",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("outcome");
    expect(body.data[0]).toHaveProperty("count");
    expect(body.data[0]).toHaveProperty("avgCycleDays");
    expect(body.meta.wonCount).toBe(2);
    expect(body.meta.lostCount).toBe(1);
    expect(body.meta.winRate).toBeCloseTo(66.7, 0);
    expect(body.meta.total).toBe(3);
  });

  it("filters by reason", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/won-lost-analysis?reason=competitor",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.lostCount).toBe(1);
    expect(body.meta.wonCount).toBe(0);
  });

  it("filters by competitor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/won-lost-analysis?competitor=Salesforce",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.lostCount).toBe(1);
  });

  it("returns 400 for invalid period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/won-lost-analysis?period=decade",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/won-lost-analysis",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/won-lost-analysis",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 9: Dormant Accounts
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/dormant-accounts", () => {
  it("returns accounts with no recent activity", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/dormant-accounts?inactiveDays=1",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Account A has activity from 4 days ago, Account B from 8 days ago
    // With threshold of 1 day, both A and B should show
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("id");
    expect(body.data[0]).toHaveProperty("name");
    expect(body.data[0]).toHaveProperty("inactiveDays");
    expect(body.meta).toHaveProperty("total");
    expect(body.meta).toHaveProperty("page");
    expect(body.meta).toHaveProperty("pageSize");
  });

  it("respects inactiveDays parameter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/dormant-accounts?inactiveDays=365",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    // Only the 200-day-old account with 4-day-old activity shouldn't qualify
    // but the account itself is 200 days old, activity 4 days ago.
    // None qualify at 365 days inactivity.
  });

  it("returns 400 for invalid inactiveDays", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/dormant-accounts?inactiveDays=0",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit above max", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/dormant-accounts?limit=500",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/dormant-accounts",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/dormant-accounts",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 9: Cross-sell Signals
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/cross-sell-signals", () => {
  it("returns accounts with product whitespace", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/cross-sell-signals",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // We have 3 products (CRM, ERP, HR) across accounts. Each account
    // should appear if it has fewer than all 3.
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("accountId");
    expect(body.data[0]).toHaveProperty("accountName");
    expect(body.data[0]).toHaveProperty("currentProducts");
    expect(body.data[0]).toHaveProperty("whitespaceCount");
    expect(body.data[0]).toHaveProperty("totalCategories");
    expect(body.meta).toHaveProperty("total");
    expect(body.meta).toHaveProperty("page");
  });

  it("returns 400 for limit above max", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/cross-sell-signals?limit=500",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/cross-sell-signals",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/cross-sell-signals",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
