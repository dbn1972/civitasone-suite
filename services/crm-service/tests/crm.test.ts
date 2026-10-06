/**
 * crm-service tests.
 * Proves CQRS wiring with MemoryQueue + MemoryCache (no Postgres/Redis required).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { createContactBody, updateContactBody } from "../src/modules/contacts/validators.js";

describe("contact validators", () => {
  it("accepts minimal create body", () => {
    const body = createContactBody.parse({ name: "Jane Doe" });
    expect(body.name).toBe("Jane Doe");
  });

  it("rejects empty name", () => {
    expect(() => createContactBody.parse({ name: "" })).toThrow();
  });
});

describe("DPDP consent validators (GAP-CRM-CONTACTS-DETAIL-EDIT-07)", () => {
  it("rejects granting marketing consent with no purpose or channel", () => {
    const parsed = createContactBody.safeParse({ name: "A", marketingConsent: true });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const codes = parsed.error.issues.map((i) => i.message);
      expect(codes).toContain("CONSENT_PURPOSE_REQUIRED");
      expect(codes).toContain("CONSENT_CHANNEL_REQUIRED");
    }
  });

  it("accepts granting marketing consent with purpose + channel", () => {
    const parsed = createContactBody.safeParse({
      name: "A",
      marketingConsent: true,
      consentPurpose: "marketing",
      consentChannel: "web_form",
    });
    expect(parsed.success).toBe(true);
  });

  it("does not require purpose/channel when consent is withdrawn (false)", () => {
    const parsed = updateContactBody.safeParse({ marketingConsent: false });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown consent purpose/channel value", () => {
    const bad = createContactBody.safeParse({
      name: "A",
      marketingConsent: true,
      consentPurpose: "spam",
      consentChannel: "pigeon",
    });
    expect(bad.success).toBe(false);
  });

  it("update body enforces purpose+channel when granting consent", () => {
    const parsed = updateContactBody.safeParse({ marketingConsent: true });
    expect(parsed.success).toBe(false);
  });
});

describe("write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, { id: string; name: string; tenantId: string; status: string }>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "crm", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();

    queue.subscribe<{ id: string; name: string; tenantId: string; status: string }>(
      "crm.contact.create",
      async (msg) => {
        store.set(msg.payload.id, {
          id: msg.payload.id,
          name: msg.payload.name,
          tenantId: msg.payload.tenantId,
          status: msg.payload.status,
        });
      }
    );
  });

  it("command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const projected = { id, tenantId, name: "Acme Corp", status: "active" };
    await cache.put(cache.makeKey(tenantId, "contact", id), projected);
    await queue.publish("crm.contact.create", {
      messageId: id,
      type: "crm.contact.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "contact", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)?.name).toBe("Acme Corp");
  });

  it("listOrLoad caches paginated results", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000003";
    const page = {
      data: [{ id: "c1", tenantId, name: "One", status: "active" }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "contact", "list:50:0", async () => {
      loads++;
      return page;
    });
    const second = await cache.listOrLoad(tenantId, "contact", "list:50:0", async () => {
      loads++;
      return page;
    });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
