/**
 * GAP-CRM-ASSIGNMENT-RULES-05 -- the assignment-rules read says WHO last changed a
 * rule and WHEN. The rule row already stored updated_at / updated_by, but the GET
 * view dropped them, so the admin page's "Last changed" column was always empty.
 *
 * DB-backed HTTP round-trip (CQRS writes drain the queue). The actor id is resolved to
 * a display name through identity-service's internal user-summaries lookup; the test
 * stubs ONLY that fetch (the app is driven in-process), and checks the failure mode:
 * an unreachable identity-service must degrade to "no name", never break the read or
 * leak the raw id as a label.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { clearUserNameCache } from "../src/shared/identity-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const realFetch = globalThis.fetch;

function headers(actor: string, roles = ["crm_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles, sid: "sess-r05" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function call(method: "GET" | "POST" | "PUT", url: string, actor: string, payload?: unknown, roles?: string[]) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(actor, roles), ...(payload === undefined ? {} : { payload }) });
  await app.close();
  await drainQueue();
  return res;
}

/** Stub identity-service's user-summaries lookup; everything else goes to the real fetch. */
function stubIdentity(users: Array<{ id: string; name: string }> | "down") {
  const seen: Array<{ tenant: string | undefined; internal: string | undefined }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes("/identity/internal/user-summaries")) return realFetch(input as RequestInfo, init);
    const h = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ tenant: h["x-tenant-id"], internal: h["x-internal"] });
    if (users === "down") throw new TypeError("connect ECONNREFUSED");
    return new Response(JSON.stringify(users), { status: 200 });
  });
  return seen;
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.assignment_rules WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});
// Each case stubs a different identity directory: forget the per-tenant name cache between them.
beforeEach(() => clearUserNameCache());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET /v1/crm/assignment-rules last-changed metadata (GAP-CRM-ASSIGNMENT-RULES-05)", () => {
  let ruleId = "";

  it("returns who created the rule and when, with the actor's display name", async () => {
    const before = Date.now();
    const created = await call("POST", "/v1/crm/assignment-rules", ACTOR_A, {
      name: "north", ruleType: "territory", criteria: { territory: "north", ownerId: randomUUID() }, ordinal: 1,
    });
    expect(created.statusCode).toBe(202);
    ruleId = created.json().id as string;

    const seen = stubIdentity([{ id: ACTOR_A, name: "Meera Rao" }, { id: ACTOR_B, name: "Dev Kumar" }]);
    const list = await call("GET", "/v1/crm/assignment-rules", ACTOR_A, undefined, ["crm_user"]);
    expect(list.statusCode).toBe(200);
    const rule = (list.json().data as Array<Record<string, unknown>>).find((r) => r.id === ruleId)!;
    expect(rule.updatedBy).toBe(ACTOR_A);
    expect(rule.updatedByName).toBe("Meera Rao");
    expect(typeof rule.updatedAt).toBe("string");
    const at = Date.parse(rule.updatedAt as string);
    expect(at).toBeGreaterThanOrEqual(before - 5_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 5_000);
    // The lookup is tenant-scoped and uses the internal service path.
    expect(seen[0]).toEqual({ tenant: TENANT, internal: "1" });
  });

  it("reflects a later change by someone else", async () => {
    const first = (await call("GET", "/v1/crm/assignment-rules", ACTOR_A, undefined, ["crm_user"])).json().data[0] as { updatedAt: string };
    await new Promise((r) => setTimeout(r, 20));
    const put = await call("PUT", `/v1/crm/assignment-rules/${ruleId}`, ACTOR_B, { name: "north zone" });
    expect(put.statusCode).toBe(202);

    stubIdentity([{ id: ACTOR_A, name: "Meera Rao" }, { id: ACTOR_B, name: "Dev Kumar" }]);
    const rule = (await call("GET", "/v1/crm/assignment-rules", ACTOR_A, undefined, ["crm_user"])).json().data[0] as Record<string, unknown>;
    expect(rule.name).toBe("north zone");
    expect(rule.updatedBy).toBe(ACTOR_B);
    expect(rule.updatedByName).toBe("Dev Kumar");
    expect(Date.parse(rule.updatedAt as string)).toBeGreaterThan(Date.parse(first.updatedAt));
  });

  it("degrades to no name (200, id kept) when identity-service is unreachable", async () => {
    stubIdentity("down");
    const res = await call("GET", "/v1/crm/assignment-rules", ACTOR_A, undefined, ["crm_user"]);
    expect(res.statusCode).toBe(200);
    const rule = res.json().data[0] as Record<string, unknown>;
    expect(rule.updatedBy).toBe(ACTOR_B);
    expect("updatedByName" in rule).toBe(false);
  });

  it("omits the name for an actor identity does not know (never substitutes the id)", async () => {
    stubIdentity([{ id: randomUUID(), name: "Someone Else" }]);
    const rule = (await call("GET", "/v1/crm/assignment-rules", ACTOR_A, undefined, ["crm_user"])).json().data[0] as Record<string, unknown>;
    expect("updatedByName" in rule).toBe(false);
  });
});
