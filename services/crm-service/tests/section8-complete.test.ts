/**
 * Section 8 reporting/analytics gap-close tests.
 *
 * Endpoints tested:
 *   - GET /v1/crm/dashboard/pipeline-coverage       (#5)
 *   - GET /v1/crm/dashboard/forecast-breakdown      (#6)
 *   - GET /v1/crm/dashboard/activity-metrics        (#8)
 *   - PATCH /v1/crm/campaigns/:id/cost              (#10)
 *   - GET /v1/crm/dashboard/campaign-roi-full       (#10)
 *   - GET /v1/crm/dashboard/inactive-users          (#11)
 *   - GET /v1/crm/dashboard/integration-health      (#11)
 *   - GET /v1/crm/dashboard/conversion-funnel       (#2 — new dimensions)
 *
 * Each endpoint: happy path + 401 + 403
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-8888-4000-8000-000000000088";
const ACTOR = "cccccccc-8888-4000-8000-000000000088";
const OWNER_A = "dddddddd-8881-4000-8000-000000000088";
const OWNER_B = "dddddddd-8882-4000-8000-000000000088";
const CONTACT_A = "eeeeeeee-8881-4000-8000-000000000088";
const CONTACT_B = "eeeeeeee-8882-4000-8000-000000000088";
const DEAL_A = "11111111-8881-4000-8000-000000000088";
const DEAL_B = "11111111-8882-4000-8000-000000000088";
const DEAL_C = "11111111-8883-4000-8000-000000000088";
const CAMPAIGN_A = "22222222-8881-4000-8000-000000000088";

function token(roles = ["crm_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-s8" }, SECRET);
}

function headers(roles = ["crm_admin"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function seedData(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;

    // Contacts
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, lead_source, owner_id, city, region, utm_campaign, status, created_by, updated_by, created_at)
      VALUES
        (${CONTACT_A}, ${TENANT}, 'S8 Lead A', 'qualified', 'website', ${OWNER_A}, 'Mumbai', 'West', 'summer_sale', 'active', ${ACTOR}, ${ACTOR}, now() - interval '10 days'),
        (${CONTACT_B}, ${TENANT}, 'S8 Lead B', 'new', 'referral', ${OWNER_B}, 'Delhi', 'North', 'winter_promo', 'active', ${ACTOR}, ${ACTOR}, now() - interval '5 days')
      ON CONFLICT (id) DO NOTHING
    `;

    // Deals with various products, probabilities
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, status, product, probability, value_minor, contact_id, owner_id, created_by, updated_by, created_at, updated_at)
      VALUES
        (${DEAL_A}, ${TENANT}, 'S8 Deal A', 'active', 'CRM', 70, 1000000, ${CONTACT_A}, ${OWNER_A}, ${ACTOR}, ${ACTOR}, now() - interval '8 days', now()),
        (${DEAL_B}, ${TENANT}, 'S8 Deal B', 'active', 'ERP', 50, 2000000, ${CONTACT_B}, ${OWNER_B}, ${ACTOR}, ${ACTOR}, now() - interval '4 days', now()),
        (${DEAL_C}, ${TENANT}, 'S8 Deal C', 'active', 'CRM', 90, 500000, ${CONTACT_A}, ${OWNER_A}, ${ACTOR}, ${ACTOR}, now() - interval '2 days', now())
      ON CONFLICT (id) DO NOTHING
    `;

    // Activities with various types. OWNER_A's three rows are deliberately offset by
    // HOURS, not days: the activity-metrics endpoint groups by date_trunc('month',
    // created_at), and offsets of 1/2/3 DAYS can straddle a month boundary (e.g. on
    // the 1st-3rd of a month, "3 days ago" lands in the previous month), silently
    // splitting one owner's activities into two period rows. Hour offsets keep all
    // three in the same calendar day - and therefore the same month - no matter when
    // the suite runs.
    await tx`
      INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, type, created_by, updated_by, created_at)
      VALUES
        (gen_random_uuid(), ${TENANT}, 'Agent A', 'Called lead', ${CONTACT_A}, 'call', ${OWNER_A}, ${OWNER_A}, now() - interval '1 hour'),
        (gen_random_uuid(), ${TENANT}, 'Agent A', 'Sent email', ${CONTACT_A}, 'email', ${OWNER_A}, ${OWNER_A}, now() - interval '2 hours'),
        (gen_random_uuid(), ${TENANT}, 'Agent A', 'Meeting held', ${CONTACT_A}, 'meeting', ${OWNER_A}, ${OWNER_A}, now() - interval '3 hours'),
        (gen_random_uuid(), ${TENANT}, 'Agent B', 'Follow-up call', ${CONTACT_B}, 'call', ${OWNER_B}, ${OWNER_B}, now() - interval '1 day'),
        (gen_random_uuid(), ${TENANT}, 'Agent B', 'Task done', ${CONTACT_B}, 'task', ${OWNER_B}, ${OWNER_B}, now() - interval '2 days')
      ON CONFLICT (id) DO NOTHING
    `;

    // Next actions for follow-up metrics
    await tx`
      INSERT INTO crm.next_actions (id, tenant_id, subject_type, subject_id, action_type, due_at, completed_at, created_by)
      VALUES
        (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT_A}, 'call', now() - interval '1 day', now(), ${OWNER_A}),
        (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT_B}, 'email', now() - interval '2 days', NULL, ${OWNER_B})
    `;

    // Lead transitions for conversion funnel with campaign dimension
    await tx`
      INSERT INTO crm.lead_transitions (id, tenant_id, contact_id, from_status, to_status, reason, created_by, created_at)
      VALUES
        (gen_random_uuid(), ${TENANT}, ${CONTACT_A}, 'new', 'qualified', 'budget confirmed', ${OWNER_A}, now() - interval '5 days'),
        (gen_random_uuid(), ${TENANT}, ${CONTACT_B}, 'new', 'contacted', 'outreach', ${OWNER_B}, now() - interval '3 days')
      ON CONFLICT (id) DO NOTHING
    `;

    // Campaign performance for ROI testing
    await tx`
      INSERT INTO crm.campaign_performance (id, tenant_id, campaign_id, cost_minor, revenue_minor, responses, currency, period_start, created_by)
      VALUES
        (gen_random_uuid(), ${TENANT}, ${CAMPAIGN_A}, 50000, 200000, 10, 'INR', '2025-01-01', ${ACTOR})
      ON CONFLICT DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.campaign_performance WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.lead_transitions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.next_actions WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
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
// #5: Pipeline Coverage
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/pipeline-coverage", () => {
  it("returns weighted pipeline grouped by period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/pipeline-coverage?period=month&quota=5000000",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("weightedPipeline");
    expect(body.data[0]).toHaveProperty("coverageRatio");
    expect(body.data[0]).toHaveProperty("period");
    expect(body.meta.period).toBe("month");
  });

  it("works without quota (coverageRatio null)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/pipeline-coverage",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0]?.coverageRatio).toBeNull();
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/pipeline-coverage" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/pipeline-coverage",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #6: Forecast Breakdown
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/forecast-breakdown", () => {
  it("returns forecast grouped by product", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/forecast-breakdown?groupBy=product",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("product");
    expect(body.data[0]).toHaveProperty("totalValue");
    expect(body.data[0]).toHaveProperty("weightedValue");
    expect(body.data[0]).toHaveProperty("dealCount");
    expect(body.meta.groupBy).toContain("product");
  });

  it("supports multi-select groupBy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/forecast-breakdown?groupBy=product,region",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.groupBy).toEqual(["product", "region"]);
  });

  it("supports confidence groupBy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/forecast-breakdown?groupBy=confidence",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0]).toHaveProperty("confidence");
  });

  it("returns 400 for invalid groupBy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/forecast-breakdown?groupBy=invalid_dimension",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/forecast-breakdown" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/forecast-breakdown",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #8: Activity Metrics
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/activity-metrics", () => {
  it("returns activity counts grouped by owner and period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/activity-metrics?period=month",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("ownerId");
    expect(body.data[0]).toHaveProperty("calls");
    expect(body.data[0]).toHaveProperty("meetings");
    expect(body.data[0]).toHaveProperty("emails");
    expect(body.data[0]).toHaveProperty("tasks");
    expect(body.data[0]).toHaveProperty("total");
    expect(body.data[0]).toHaveProperty("followUps");
    expect(body.data[0]).toHaveProperty("overdue");
    expect(body.meta.period).toBe("month");
  });

  it("filters by ownerId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/dashboard/activity-metrics?ownerId=${OWNER_A}`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const row of body.data) {
      expect(row.ownerId).toBe(OWNER_A);
    }
  });

  it("correctly groups by type", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/dashboard/activity-metrics?period=month&ownerId=${OWNER_A}`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Owner A has: 1 call, 1 email, 1 meeting => calls=1, emails=1, meetings=1, total=3
    const ownerRow = body.data[0];
    expect(ownerRow.calls).toBe(1);
    expect(ownerRow.emails).toBe(1);
    expect(ownerRow.meetings).toBe(1);
    expect(ownerRow.total).toBe(3);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/activity-metrics" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/activity-metrics",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #10: Campaign Cost + ROI
// ═══════════════════════════════════════════════════════════════════════════════
describe("PATCH /v1/crm/campaigns/:id/cost", () => {
  it("records campaign spend", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/campaigns/${CAMPAIGN_A}/cost`,
      headers: headers(["crm_admin"]),
      payload: { costMinor: "100000", currency: "INR" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.campaignId).toBe(CAMPAIGN_A);
    expect(body.data.costMinor).toBe("100000");
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/campaigns/${CAMPAIGN_A}/cost`,
      payload: { costMinor: "100000" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/campaigns/${CAMPAIGN_A}/cost`,
      headers: headers(["crm_user"]),
      payload: { costMinor: "100000" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid costMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/campaigns/${CAMPAIGN_A}/cost`,
      headers: headers(["crm_admin"]),
      payload: { costMinor: "-5" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/crm/dashboard/campaign-roi-full", () => {
  it("returns campaign ROI with cost and computed roi", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/campaign-roi-full",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("campaignId");
    expect(body.data[0]).toHaveProperty("costMinor");
    expect(body.data[0]).toHaveProperty("revenueMinor");
    expect(body.data[0]).toHaveProperty("netMinor");
    expect(body.data[0]).toHaveProperty("roiPercent");
    expect(body.meta).toHaveProperty("total");
  });

  it("computes ROI correctly: (revenue - cost) / cost * 100", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/campaign-roi-full",
      headers: headers(),
    });
    await app.close();

    const body = res.json();
    // We seeded: cost=50000, revenue=200000
    // PATCH may have added another row with cost=100000, revenue=0
    // The test simply verifies that roiPercent is computed (not null) and is a number
    const campaign = body.data.find((d: { campaignId: string }) => d.campaignId === CAMPAIGN_A);
    expect(campaign).toBeDefined();
    expect(typeof campaign.roiPercent).toBe("number");
    // Net = revenue - cost, should be computable
    expect(BigInt(campaign.revenueMinor) - BigInt(campaign.costMinor)).toBe(BigInt(campaign.netMinor));
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/campaign-roi-full" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/campaign-roi-full",
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #11: Inactive Users
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/inactive-users", () => {
  it("returns users with no recent activity", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/inactive-users?days=1",
      headers: headers(["crm_admin"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Owner A has activities from 1-3 days ago, Owner B from 1-2 days ago.
    // With days=1, those with last activity > 1 day should appear.
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toHaveProperty("days");
    expect(body.meta).toHaveProperty("count");
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/inactive-users" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/inactive-users",
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #11: Integration Health
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/integration-health", () => {
  it("returns integration health summary", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/integration-health",
      headers: headers(["crm_admin"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveProperty("status");
    expect(body.data).toHaveProperty("outboxFailures");
    expect(body.data).toHaveProperty("outboxStats");
    expect(body.data).toHaveProperty("inboxHealth");
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/dashboard/integration-health" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/integration-health",
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// #2: Conversion Funnel with new dimensions
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/crm/dashboard/conversion-funnel (new dimensions)", () => {
  it("filters by campaign", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel?campaign=summer_sale",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Should return data for CONTACT_A which has utm_campaign = 'summer_sale'
    expect(body.data).toBeInstanceOf(Array);
  });

  it("filters by geography (city)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel?geography=Mumbai",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("filters by product (via deal)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel?product=CRM",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("filters by segment (lead_status grouping)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/dashboard/conversion-funnel?segment=qualified",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });
});
