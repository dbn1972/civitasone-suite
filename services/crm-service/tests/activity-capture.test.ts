/**
 * Automatic email/calendar capture tests (AC-004, WC-003, WC-004).
 * Covers idempotent ingest on (source, externalId), manual matching, the
 * capture-health report, and the deliberate no-body/PII posture.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { resolveMatch } from "../src/modules/activities/capture-routes.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000064";
const ACTOR = "cccccccc-3333-4000-8000-000000000064";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000064";

const CONTACT_A = "11111111-6400-4000-8000-000000000001";
const CONTACT_B = "11111111-6400-4000-8000-000000000002";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-capture" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function seed(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${CONTACT_A}, ${TENANT}, 'Capture Contact A', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${CONTACT_B}, ${TENANT}, 'Capture Contact B', 'new', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.captured_activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function ingest(payload: Record<string, unknown>, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/activities/capture",
    headers: headers(roles),
    payload,
  });
  await app.close();
  return res;
}

describe("resolveMatch (pure)", () => {
  it("treats a single candidate as a confident match", () => {
    expect(resolveMatch([CONTACT_A])).toEqual({
      matchStatus: "matched",
      contactId: CONTACT_A,
      confidence: "1.0000",
    });
  });

  it("treats several candidates as ambiguous with split confidence", () => {
    const r = resolveMatch([CONTACT_A, CONTACT_B]);
    expect(r.matchStatus).toBe("ambiguous");
    expect(r.contactId).toBeNull();
    expect(r.confidence).toBe("0.5000");
  });

  it("de-duplicates repeated candidates", () => {
    expect(resolveMatch([CONTACT_A, CONTACT_A]).matchStatus).toBe("matched");
  });

  it("treats no candidates as unmatched", () => {
    expect(resolveMatch([])).toEqual({
      matchStatus: "unmatched",
      contactId: null,
      confidence: "0.0000",
    });
  });
});

describe("POST /v1/crm/activities/capture", () => {
  it("ingests an email item → 202", async () => {
    const res = await ingest({
      source: "email",
      externalId: "graph-msg-0001",
      subject: "Re: renewal terms",
      occurredAt: new Date().toISOString(),
      participants: ["buyer@example.gov.in"],
      candidateContactIds: [CONTACT_A],
      rawRef: "s3://mail-archive/graph-msg-0001",
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.deduplicated).toBe(false);
    expect(body.matchStatus).toBe("matched");
  });

  it("is idempotent on a duplicate (source, externalId)", async () => {
    const first = await ingest({
      source: "calendar",
      externalId: "cal-evt-0007",
      subject: "Quarterly sync",
      candidateContactIds: [],
    });
    const second = await ingest({
      source: "calendar",
      externalId: "cal-evt-0007",
      subject: "Quarterly sync (redelivered)",
      candidateContactIds: [],
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().deduplicated).toBe(true);
    expect(second.json().id).toBe(first.json().id);

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`
        SELECT count(*)::int AS count FROM crm.captured_activities
        WHERE tenant_id = ${TENANT} AND source = 'calendar' AND external_id = 'cal-evt-0007'
      `;
    });
    expect(rows[0]?.count).toBe(1);
  });

  it("marks several candidates as ambiguous", async () => {
    const res = await ingest({
      source: "email",
      externalId: "graph-msg-0002",
      subject: "Introductions",
      candidateContactIds: [CONTACT_A, CONTACT_B],
    });
    expect(res.json().matchStatus).toBe("ambiguous");
  });

  it("stores no message body — only subject, participants and a pointer", async () => {
    await ingest({
      source: "email",
      externalId: "graph-msg-0003",
      subject: "Contract draft",
      participants: ["legal@example.gov.in"],
      rawRef: "s3://mail-archive/graph-msg-0003",
      // A connector sending a body must have it ignored, not persisted.
      body: "SECRET BODY TEXT THAT MUST NEVER BE STORED",
    });

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`
        SELECT * FROM crm.captured_activities
        WHERE tenant_id = ${TENANT} AND external_id = 'graph-msg-0003'
      `;
    });
    const row = rows[0] as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {})).not.toContain("body");
    expect(JSON.stringify(row)).not.toContain("SECRET BODY TEXT");
    expect(row?.["raw_ref"]).toBe("s3://mail-archive/graph-msg-0003");
  });

  it("rejects an unknown source → 400", async () => {
    const res = await ingest({ source: "sms", externalId: "x-1" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing externalId → 400", async () => {
    const res = await ingest({ source: "email" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/activities/capture",
      payload: { source: "email", externalId: "no-auth-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const res = await ingest({ source: "email", externalId: "forbidden-1" }, ["citizen"]);
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/activities/capture", () => {
  it("lists captured items with the envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/activities/capture",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBeGreaterThanOrEqual(3);
  });

  it("filters by matchStatus", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/activities/capture?matchStatus=unmatched",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    for (const row of res.json().data) {
      expect(row.matchStatus).toBe("unmatched");
    }
  });

  it("filters by source", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/activities/capture?source=calendar",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    for (const row of res.json().data) {
      expect(row.source).toBe("calendar");
    }
  });

  it("rejects an unknown matchStatus → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/activities/capture?matchStatus=maybe",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/activities/capture" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/crm/activities/capture/health", () => {
  it("reports counts by status and an integer match rate", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/activities/capture/health",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.total).toBeGreaterThanOrEqual(3);
    expect(d.byStatus.matched + d.byStatus.unmatched + d.byStatus.ambiguous).toBe(d.total);
    expect(Number.isInteger(d.matchRateBps)).toBe(true);
    expect(d.matchRateBps).toBeGreaterThanOrEqual(0);
    expect(d.matchRateBps).toBeLessThanOrEqual(10_000);
  });

  it("reports a healthy empty tenant without dividing by zero", async () => {
    const emptyTenant = "aaaaaaaa-1111-4000-8000-00000000064e";
    const emptyToken = signToken(
      { sub: ACTOR, tid: emptyTenant, roles: ["crm_user"], sid: "sess-capture-empty" },
      SECRET,
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/activities/capture/health",
      headers: { authorization: `Bearer ${emptyToken}`, "x-tenant-id": emptyTenant },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ total: 0, matchRateBps: 0, healthy: true });
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/activities/capture/health" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/activities/capture/:id/match", () => {
  it("attaches an unmatched item to a contact → 200", async () => {
    const created = await ingest({ source: "email", externalId: "graph-msg-0010", subject: "Cold email" });
    const id = created.json().id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/activities/capture/${id}/match`,
      headers: headers(),
      payload: { contactId: CONTACT_B },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.matchStatus).toBe("matched");
    expect(res.json().data.contactId).toBe(CONTACT_B);
    expect(res.json().data.version).toBe(2);
  });

  it("returns 404 for an unknown captured item", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/activities/capture/${NONEXIST}/match`,
      headers: headers(),
      payload: { contactId: CONTACT_A },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown contact", async () => {
    const created = await ingest({ source: "email", externalId: "graph-msg-0011" });
    const id = created.json().id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/activities/capture/${id}/match`,
      headers: headers(),
      payload: { contactId: NONEXIST },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("rejects a missing contactId → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/activities/capture/${NONEXIST}/match`,
      headers: headers(),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/activities/capture/${NONEXIST}/match`,
      payload: { contactId: CONTACT_A },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/activities/capture/${NONEXIST}/match`,
      headers: headers(["citizen"]),
      payload: { contactId: CONTACT_A },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
