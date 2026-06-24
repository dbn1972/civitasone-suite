import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { computeHash } from "../src/modules/events/domain.js";

describe("audit event hash chain", () => {
  it("produces deterministic sha256 hash", () => {
    const h1 = computeHash("id1", "tenant1", "identity.user.created", null, "2026-06-20T00:00:00.000Z");
    const h2 = computeHash("id1", "tenant1", "identity.user.created", null, "2026-06-20T00:00:00.000Z");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("different prev_hash produces different output", () => {
    const h1 = computeHash("id1", "t1", "type", null, "2026-06-20T00:00:00.000Z");
    const h2 = computeHash("id1", "t1", "type", "prev", "2026-06-20T00:00:00.000Z");
    expect(h1).not.toBe(h2);
  });
});

describe("audit consumer queue wiring", () => {
  let q: MemoryQueue;
  const store: Array<{ tenantId: string; type: string }> = [];

  beforeEach(() => {
    q = new MemoryQueue();
    store.length = 0;
    q.subscribe<{ service: string; action: string; resourceType: string; resourceId: string; outcome: string }>(
      "audit.event.record",
      async (msg) => { store.push({ tenantId: msg.tenantId, type: msg.type }); }
    );
  });

  it("routes audit.event.record to consumer", async () => {
    await q.publish("audit.event.record", {
      messageId: "m1", type: "audit.event.record", tenantId: "t1", actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0",
      payload: { service: "policy", action: "create", resourceType: "role", resourceId: "r1", outcome: "success" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(store).toHaveLength(1);
    expect(store[0]?.tenantId).toBe("t1");
  });

  it("dedupes repeated messageId", async () => {
    let count = 0;
    q.subscribe("audit.event.ingest", async () => { count++; });
    const opts = { messageId: "dup-msg", type: "audit.event.ingest", tenantId: "t1", actorId: "a1", correlationId: "c1", schemaVersion: "1.0", payload: { service: "s", action: "a", resourceType: "r", resourceId: "x", outcome: "success" } };
    await q.publish("audit.event.ingest", opts);
    await q.publish("audit.event.ingest", opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(1);
  });
});

describe("audit-service route auth (inject)", () => {
  it("GET /v1/audit/risks without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/audit/risks" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/audit/exports without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/audit/exports" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// P1-5: bulk PII export is restricted to audit_admin+ (audit_officer must be rejected).
describe("P1-5 export PII gating", () => {
  const SECRET = "test_secret_for_civitasone_32chr";
  const TENANT = "00000000-0000-0000-0000-000000000001";

  async function token(roles: string[]): Promise<string> {
    const { signToken } = await import("@civitasone/auth");
    return signToken({ sub: "11111111-1111-1111-1111-111111111111", tid: TENANT, roles } as never, SECRET);
  }

  it("audit_officer requesting includePii → 403 PII_EXPORT_FORBIDDEN", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const jwt = await token(["audit_officer"]);
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT, "content-type": "application/json" },
      payload: { from: "2026-06-23T00:00:00Z", to: "2026-06-24T00:00:00Z", format: "json", includePii: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("PII_EXPORT_FORBIDDEN");
    await app.close();
  });

  it("audit_admin requesting includePii → accepted", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const jwt = await token(["audit_admin"]);
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT, "content-type": "application/json" },
      payload: { from: "2026-06-23T00:00:00Z", to: "2026-06-24T00:00:00Z", format: "json", includePii: true },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });

  it("oversized window → 422 WINDOW_TOO_LARGE", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const jwt = await token(["audit_admin"]);
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT, "content-type": "application/json" },
      payload: { from: "2026-01-01T00:00:00Z", to: "2026-12-01T00:00:00Z", format: "json" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("WINDOW_TOO_LARGE");
    await app.close();
  });
});
