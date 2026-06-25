import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";

describe("notification-service queue wiring", () => {
  let q: MemoryQueue;
  let cache: Cache;
  const templates = new Map<string, { id: string; name: string; body: string }>();
  const deliveries: Array<{ templateId: string; recipient: string }> = [];

  beforeEach(() => {
    q = new MemoryQueue();
    cache = new Cache({ service: "notification", store: new MemoryCache(), defaultTtlSeconds: 60 });
    templates.clear();
    deliveries.length = 0;

    q.subscribe<{ id: string; name: string; body: string }>("notification.template.create", async (msg) => {
      templates.set(msg.payload.id, { id: msg.payload.id, name: msg.payload.name, body: msg.payload.body });
    });

    q.subscribe<{ templateId: string; recipient: string }>("notification.send", async (msg) => {
      deliveries.push({ templateId: msg.payload.templateId, recipient: msg.payload.recipient });
    });
  });

  it("template create is applied asynchronously", async () => {
    const id = "aaaaaaaa-1111-4000-8000-000000000001";
    await q.publish("notification.template.create", {
      messageId: id, type: "notification.template.create", tenantId: "t1", actorId: "a1",
      correlationId: "c1", schemaVersion: "1.0",
      payload: { id, tenantId: "t1", channel: "email", name: "Welcome Email", body: "Welcome to CivitasOne!" },
    });
    expect(templates.has(id)).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(templates.get(id)?.name).toBe("Welcome Email");
  });

  it("notification.send routes to delivery consumer", async () => {
    const templateId = "bbbbbbbb-2222-4000-8000-000000000002";
    await q.publish("notification.send", {
      messageId: "10000000-0000-4000-8000-000000000002", type: "notification.send", tenantId: "t1", actorId: "a1",
      correlationId: "c2", schemaVersion: "1.0",
      payload: { templateId, recipient: "user@dept.gov.in", channel: "email" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.recipient).toBe("user@dept.gov.in");
  });

  it("cache read-through on prefs miss", async () => {
    const prefs = [{ userId: "u1", eventType: "login", inApp: true, email: false, push: false }];
    const v = await cache.getOrLoad("notification:t1:prefs:u1", async () => prefs);
    expect(v).toHaveLength(1);
    const again = await cache.getOrLoad("notification:t1:prefs:u1", async () => []);
    expect(again).toHaveLength(1);
  });

  it("dedupes repeated messageId", async () => {
    let count = 0;
    q.subscribe("notification.test", async () => { count++; });
    const opts = { messageId: "10000000-0000-4000-8000-0000000000d0", type: "notification.test", tenantId: "t", actorId: "u", correlationId: "c", schemaVersion: "1.0", payload: {} };
    await q.publish("notification.test", opts);
    await q.publish("notification.test", opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(count).toBe(1);
  });
});
