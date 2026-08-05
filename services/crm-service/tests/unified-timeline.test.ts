/**
 * G6 — Unified Customer Timeline tests.
 *
 * Validates cross-service aggregation from notification-service and telephony-service,
 * graceful degradation when services are down, pagination, auth, and tenant header
 * forwarding.
 */
import { describe, it, expect, afterAll, beforeAll, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000006006";
const ACTOR = "cccccccc-3333-4000-8000-000000006006";
const CONTACT = "22222222-bbbb-4000-8000-000000006006";

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

// ── Mock data from external services ──

const mockDeliveries = [
  {
    id: "del-001",
    channel: "email",
    status: "delivered",
    subject: "Welcome",
    sentAt: "2026-07-10T10:00:00Z",
    recipientId: CONTACT,
  },
  {
    id: "del-002",
    channel: "sms",
    status: "sent",
    sentAt: "2026-07-09T08:00:00Z",
    recipientId: CONTACT,
  },
];

const mockCalls = [
  {
    id: "call-001",
    direction: "outbound",
    status: "completed",
    duration: 120,
    startedAt: "2026-07-10T14:00:00Z",
    contactId: CONTACT,
  },
  {
    id: "call-002",
    direction: "inbound",
    status: "missed",
    startedAt: "2026-07-08T09:30:00Z",
    contactId: CONTACT,
  },
];

const mockConversations = [
  {
    id: "conv-001",
    channel: "whatsapp",
    subject: "Order inquiry",
    messageCount: 5,
    lastMessageAt: "2026-07-10T16:00:00Z",
    contactId: CONTACT,
  },
];

// ── Fetch mock setup ──

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchAll() {
  fetchMock = vi.fn((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (urlStr.includes("/notifications/deliveries")) {
      return Promise.resolve(new Response(JSON.stringify({ data: mockDeliveries }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (urlStr.includes("/v1/telephony/calls")) {
      return Promise.resolve(new Response(JSON.stringify({ data: mockCalls }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (urlStr.includes("/notifications/inbox")) {
      return Promise.resolve(new Response(JSON.stringify({ data: mockConversations }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function mockFetchNotificationDown() {
  fetchMock = vi.fn((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url;
    if (urlStr.includes("/notifications/")) {
      return Promise.resolve(new Response("service unavailable", { status: 503 }));
    }
    if (urlStr.includes("/v1/telephony/calls")) {
      return Promise.resolve(new Response(JSON.stringify({ data: mockCalls }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function mockFetchBothDown() {
  fetchMock = vi.fn(() => {
    return Promise.resolve(new Response("service unavailable", { status: 503 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function mockFetchTimeout() {
  fetchMock = vi.fn(() => {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error("AbortError")), 100);
    });
  });
  vi.stubGlobal("fetch", fetchMock);
}

// ── DB setup/teardown ──

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.communications WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, score, version, created_at, updated_at, created_by, updated_by)
             VALUES (${CONTACT}, ${TENANT}, 'Timeline Test Contact', 'qualified', 'active', 50, 1, now(), now(), ${ACTOR}, ${ACTOR}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, type, subject, status, version, created_at, created_by, updated_by, updated_at)
             VALUES (gen_random_uuid(), ${TENANT}, 'Agent', 'called the contact', ${CONTACT}, 'call', 'Discovery Call', 'completed', 1, '2026-07-10T12:00:00Z', ${ACTOR}, ${ACTOR}, now())`;
    await tx`INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, type, subject, status, version, created_at, created_by, updated_by, updated_at)
             VALUES (gen_random_uuid(), ${TENANT}, 'Agent', 'sent proposal', ${CONTACT}, 'task', 'Send Proposal', 'open', 1, '2026-07-09T15:00:00Z', ${ACTOR}, ${ACTOR}, now())`;
    await tx`INSERT INTO crm.communications (id, tenant_id, subject_type, subject_id, direction, channel, summary, occurred_at, logged_by)
             VALUES (gen_random_uuid(), ${TENANT}, 'contact', ${CONTACT}, 'outbound', 'email', 'Proposal email', '2026-07-10T11:00:00Z', ${ACTOR})`;
  });
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function getTimeline(query = "", roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `/v1/crm/contacts/${CONTACT}/timeline${query}`,
    headers: headers(roles),
  });
  await app.close();
  return res;
}

// ── Tests ──

describe("G6 Unified Customer Timeline", () => {
  describe("happy path: all services up", () => {
    beforeEach(() => mockFetchAll());

    it("merges CRM-local + cross-service data sorted by timestamp (most recent first)", async () => {
      const res = await getTimeline();
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.meta).toBeDefined();

      // We have 3 CRM items + 2 deliveries + 2 calls + 1 conversation = 8
      expect(body.meta.total).toBe(8);
      expect(body.data.length).toBe(8);

      // Check sorting — most recent first
      for (let i = 0; i < body.data.length - 1; i++) {
        const cur = new Date(body.data[i].timestamp).getTime();
        const next = new Date(body.data[i + 1].timestamp).getTime();
        expect(cur).toBeGreaterThanOrEqual(next);
      }
    });

    it("returns correct item types from each source", async () => {
      const res = await getTimeline();
      const items = res.json().data;

      const types = items.map((i: { type: string }) => i.type);
      expect(types).toContain("activity");
      expect(types).toContain("communication");
      expect(types).toContain("delivery");
      expect(types).toContain("call");
      expect(types).toContain("conversation");

      const sources = items.map((i: { source: string }) => i.source);
      expect(sources).toContain("crm");
      expect(sources).toContain("notification");
      expect(sources).toContain("telephony");
    });

    it("each item has the standard timeline shape", async () => {
      const res = await getTimeline();
      const items = res.json().data;
      for (const item of items) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("timestamp");
        expect(item).toHaveProperty("summary");
        expect(item).toHaveProperty("source");
        expect(item).toHaveProperty("metadata");
        expect(typeof item.id).toBe("string");
        expect(typeof item.summary).toBe("string");
      }
    });

    it("forwards tenant and auth headers to downstream services", async () => {
      const res = await getTimeline();
      expect(res.statusCode).toBe(200);

      // Verify fetch was called with correct headers
      expect(fetchMock).toHaveBeenCalled();
      for (const call of fetchMock.mock.calls) {
        const opts = call[1] as { headers: Record<string, string> };
        expect(opts.headers["x-tenant-id"]).toBe(TENANT);
        expect(opts.headers.authorization).toContain("Bearer ");
      }
    });
  });

  describe("graceful degradation: notification-service down", () => {
    beforeEach(() => mockFetchNotificationDown());

    it("returns CRM data + telephony data, marks notification unavailable", async () => {
      const res = await getTimeline();
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // CRM items (3) + telephony calls (2) = 5
      expect(body.meta.total).toBe(5);

      const sources = body.data.map((i: { source: string }) => i.source);
      expect(sources).toContain("crm");
      expect(sources).toContain("telephony");
      expect(sources).not.toContain("notification");

      // Service status indicates notification is unavailable
      expect(body.services).toBeDefined();
      expect(body.services).toContainEqual(
        expect.objectContaining({ source: "notification", status: "unavailable" }),
      );
    });
  });

  describe("graceful degradation: both services down", () => {
    beforeEach(() => mockFetchBothDown());

    it("returns CRM-only data, never 500s", async () => {
      const res = await getTimeline();
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Only CRM items (3)
      expect(body.meta.total).toBe(3);

      const sources = [...new Set(body.data.map((i: { source: string }) => i.source))];
      expect(sources).toEqual(["crm"]);

      // Both marked unavailable
      expect(body.services).toBeDefined();
      expect(body.services.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("graceful degradation: timeout", () => {
    beforeEach(() => mockFetchTimeout());

    it("returns CRM-only data on timeout, never 500s", async () => {
      const res = await getTimeline();
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.meta.total).toBe(3);
    });
  });

  describe("auth / authz", () => {
    beforeEach(() => mockFetchAll());

    it("401 without authorization header", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/v1/crm/contacts/${CONTACT}/timeline`,
        headers: { "x-tenant-id": TENANT },
      });
      await app.close();
      expect(res.statusCode).toBe(401);
    });

    it("403 for a non-CRM role", async () => {
      const res = await getTimeline("", ["citizen"]);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("pagination", () => {
    beforeEach(() => mockFetchAll());

    it("respects limit parameter", async () => {
      const res = await getTimeline("?limit=3");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(3);
      expect(body.meta.total).toBe(8);
      expect(body.meta.limit).toBe(3);
      expect(body.meta.hasMore).toBe(true);
    });

    it("respects offset parameter", async () => {
      const res = await getTimeline("?limit=3&offset=6");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBe(2); // 8 total, offset 6 → 2 remaining
      expect(body.meta.offset).toBe(6);
      expect(body.meta.hasMore).toBe(false);
    });

    it("rejects limit > 200", async () => {
      const res = await getTimeline("?limit=201");
      expect(res.statusCode).toBe(400);
    });

    it("rejects negative offset", async () => {
      const res = await getTimeline("?offset=-1");
      expect(res.statusCode).toBe(400);
    });
  });

  describe("not found", () => {
    beforeEach(() => mockFetchAll());

    it("404s for unknown contact", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/crm/contacts/ffffffff-ffff-4000-8000-ffffffffffff/timeline",
        headers: headers(),
      });
      await app.close();
      expect(res.statusCode).toBe(404);
    });

    it("400 for invalid UUID param", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/crm/contacts/not-a-uuid/timeline",
        headers: headers(),
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  });
});
