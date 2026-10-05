/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback HTTP → consumer → DB.
 *
 * Covers: POST records a rating (202, CQRS) that lands in crm.citizen_feedback;
 * the ratings summary tile aggregates average + count and reports '—'/0 when
 * empty; the admin-only list returns the comment text and a non-admin is refused;
 * optional "Regarding" serviceRequestId round-trips; cross-tenant RLS isolation.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-00000000f001";
const OTHER = "aaaaaaaa-1111-4000-8000-00000000f002";
const ACTOR = "cccccccc-3333-4000-8000-00000000f001";
const SR_ID = "44444444-dddd-4000-8000-00000000f001";

function headers(tenant = TENANT, roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": tenant,
  };
}
function adminHeaders(tenant = TENANT) {
  return headers(tenant, ["crm_admin"]);
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await sqlClient
      .begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
        await tx`DELETE FROM crm.citizen_feedback WHERE tenant_id = ${t}`.catch(() => {});
      })
      .catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

async function inject(method: string, url: string, opts: { headers: Record<string, string>; payload?: unknown }) {
  const app = await buildApp();
  const res = await app.inject({ method: method as "GET", url, headers: opts.headers, payload: opts.payload as object });
  await app.close();
  return res;
}

async function record(body: Record<string, unknown>, tenant = TENANT) {
  const res = await inject("POST", "/v1/crm/citizen-feedback", { headers: headers(tenant), payload: body });
  await drainQueue();
  return res;
}

describe("citizen feedback record", () => {
  it("records a rating (202) that lands in the DB and feeds the summary tile", async () => {
    const res = await record({ rating: 5, comment: "Fast and courteous service" });
    expect(res.statusCode).toBe(202);

    const summary = await inject("GET", "/v1/crm/citizen-feedback/summary", { headers: headers() });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data.count).toBe(1);
    expect(summary.json().data.average).toBe(5);
  });

  it("averages multiple ratings and keeps a running count", async () => {
    await record({ rating: 3 });
    await record({ rating: 4 });
    const summary = await inject("GET", "/v1/crm/citizen-feedback/summary", { headers: headers() });
    // 5 + 3 + 4 = 12 over 3 = 4.0
    expect(summary.json().data.count).toBe(3);
    expect(summary.json().data.average).toBe(4);
  });

  it("rejects an out-of-range rating (400)", async () => {
    const res = await inject("POST", "/v1/crm/citizen-feedback", { headers: headers(), payload: { rating: 6 } });
    expect(res.statusCode).toBe(400);
  });

  it("round-trips an optional 'Regarding' service request reference", async () => {
    await record({ rating: 2, comment: "Still pending", serviceRequestId: SR_ID });
    const list = await inject("GET", "/v1/crm/citizen-feedback?limit=50", { headers: adminHeaders() });
    const row = (list.json().data as Array<{ serviceRequestId: string | null; rating: number }>).find(
      (r) => r.serviceRequestId === SR_ID,
    );
    expect(row).toBeTruthy();
    expect(row?.rating).toBe(2);
  });

  it("shows the comment text only to CRM admins; a non-admin is refused the list", async () => {
    const asUser = await inject("GET", "/v1/crm/citizen-feedback", { headers: headers() });
    expect(asUser.statusCode).toBe(403);

    const asAdmin = await inject("GET", "/v1/crm/citizen-feedback?limit=50", { headers: adminHeaders() });
    expect(asAdmin.statusCode).toBe(200);
    const comments = (asAdmin.json().data as Array<{ comment: string | null }>).map((r) => r.comment);
    expect(comments).toContain("Fast and courteous service");
  });
});

describe("citizen feedback summary when empty", () => {
  it("reports count 0 and a null average for a tenant with no feedback", async () => {
    const summary = await inject("GET", "/v1/crm/citizen-feedback/summary", { headers: headers(OTHER) });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data.count).toBe(0);
    expect(summary.json().data.average).toBeNull();
  });
});

describe("citizen feedback RLS", () => {
  it("never exposes another tenant's feedback in the summary", async () => {
    await record({ rating: 1 }, OTHER);
    const other = await inject("GET", "/v1/crm/citizen-feedback/summary", { headers: headers(OTHER) });
    expect(other.json().data.count).toBe(1);
    // TENANT still sees only its own three ratings (unchanged by OTHER's write).
    const mine = await inject("GET", "/v1/crm/citizen-feedback/summary", { headers: headers() });
    expect(mine.json().data.count).toBe(4); // 5,3,4 + the SR_ID rating of 2
  });
});
