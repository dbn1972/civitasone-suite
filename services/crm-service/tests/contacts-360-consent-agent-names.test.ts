/**
 * Cluster 02 backend gaps, DB-backed HTTP round-trips:
 *
 *  GAP-CRM-CONTACTS-DETAIL-02  GET /v1/crm/contacts/:id/360 carries the DPDP consent
 *      RECORD (purpose, capture channel = source, last-changed instant) instead of
 *      only a boolean + bare date, so the detail page can show what the consent
 *      was given for and where it came from.
 *  GAP-CRM-CONTACTS-DETAIL-01  GET /v1/crm/teams/agents decorates each agent with
 *      the person's display NAME (identity-service summaries, id + name only), so
 *      the assign / transfer owner picker shows people, not "Unnamed agent". When
 *      identity is unreachable the list still answers and `name` is simply absent.
 */
import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { clearIdentityNameCache } from "../src/shared/identity-client.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000c0202";
const ACTOR = "cccccccc-3333-4000-8000-0000000c0202";
const AGENT_NAMED = "eeeeeeee-5555-4000-8000-0000000c0202";
const AGENT_UNKNOWN = "ffffffff-6666-4000-8000-0000000c0202";

function headers(roles: string[]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function inject(method: "GET" | "POST", url: string, roles: string[], payload?: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(roles), ...(payload ? { payload } : {}) });
  await app.close();
  await drainQueue();
  return res;
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearIdentityNameCache();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GAP-CRM-CONTACTS-DETAIL-02: 360 consent record", () => {
  it("returns purpose, channel and updatedAt alongside the boolean", async () => {
    const created = await inject("POST", "/v1/crm/contacts", ["crm_admin"], {
      name: "Consent Cathy",
      marketingConsent: true,
      consentPurpose: "service_updates",
      consentChannel: "phone",
    });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;

    const res = await inject("GET", `/v1/crm/contacts/${id}/360`, ["crm_user"]);
    expect(res.statusCode).toBe(200);
    const consent = res.json().data.consent as Record<string, unknown>;
    expect(consent.marketingConsent).toBe(true);
    expect(consent.consentDate).toBeTruthy();
    expect(consent.purpose).toBe("service_updates");
    expect(consent.channel).toBe("phone");
    expect(typeof consent.updatedAt).toBe("string");
  });

  it("a contact with no consent record reports null purpose/channel (not invented values)", async () => {
    const created = await inject("POST", "/v1/crm/contacts", ["crm_admin"], { name: "No Consent Nina" });
    const id = created.json().id as string;
    const res = await inject("GET", `/v1/crm/contacts/${id}/360`, ["crm_user"]);
    const consent = res.json().data.consent as Record<string, unknown>;
    expect(consent.marketingConsent).toBe(false);
    expect(consent.purpose).toBeNull();
    expect(consent.channel).toBeNull();
    expect(consent.updatedAt).toBeNull();
  });
});

describe("GAP-CRM-CONTACTS-DETAIL-01: agents carry a display name", () => {
  beforeAll(async () => {
    await scoped(async (tx) => {
      await tx`INSERT INTO crm.agent_workload (id, tenant_id, agent_id, max_leads, current_load, available)
               VALUES (${randomUUID()}, ${TENANT}, ${AGENT_NAMED}, 10, 2, true)`;
      await tx`INSERT INTO crm.agent_workload (id, tenant_id, agent_id, max_leads, current_load, available)
               VALUES (${randomUUID()}, ${TENANT}, ${AGENT_UNKNOWN}, 10, 5, true)`;
    });
  });

  it("adds `name` from identity-service for resolvable agents and leaves others without one", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/identity/internal/user-summaries");
      expect((init?.headers as Record<string, string>)["x-tenant-id"]).toBe(TENANT);
      return new Response(JSON.stringify([{ id: AGENT_NAMED, name: "Nita Shah" }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await inject("GET", "/v1/crm/teams/agents", ["crm_user"]);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ agentId: string; name?: string }>;
    const named = data.find((a) => a.agentId === AGENT_NAMED);
    const unknown = data.find((a) => a.agentId === AGENT_UNKNOWN);
    expect(named?.name).toBe("Nita Shah");
    expect(unknown).toBeDefined();
    expect(unknown?.name).toBeUndefined();
  });

  it("still answers 200 (without names) when identity-service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }));
    const res = await inject("GET", "/v1/crm/teams/agents", ["crm_user"]);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ agentId: string; name?: string }>;
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data.every((a) => a.name === undefined)).toBe(true);
  });
});
