import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { upsertBrandingBody } from "../src/modules/branding/validators.js";
import { createTemplateBody, templateTypeEnum } from "../src/modules/templates/validators.js";

/* ─── branding validators ────────────────────────────────────────────── */
describe("branding validators", () => {
  it("accepts valid upsert body with all fields", () => {
    const body = upsertBrandingBody.parse({
      logoS3Key: "tenants/abc/logo.png",
      faviconS3Key: "tenants/abc/favicon.ico",
      appName: "MyGovApp",
      primaryColor: "#1e40af",
      accentColor: "#f59e0b",
      footerText: "© 2024 Government of India",
    });
    expect(body.appName).toBe("MyGovApp");
    expect(body.primaryColor).toBe("#1e40af");
  });

  it("accepts empty body (all optional)", () => {
    const body = upsertBrandingBody.parse({});
    expect(body.logoS3Key).toBeUndefined();
  });

  it("rejects invalid hex color", () => {
    expect(() => upsertBrandingBody.parse({ primaryColor: "red" })).toThrow();
    expect(() => upsertBrandingBody.parse({ primaryColor: "#GGG" })).toThrow();
    expect(() => upsertBrandingBody.parse({ accentColor: "123456" })).toThrow();
  });

  it("rejects appName exceeding max length", () => {
    expect(() => upsertBrandingBody.parse({ appName: "x".repeat(129) })).toThrow();
  });
});

/* ─── template validators ────────────────────────────────────────────── */
describe("template validators", () => {
  it("accepts valid template creation", () => {
    const body = createTemplateBody.parse({
      type: "email",
      name: "Welcome Email",
      htmlBody: "<h1>Welcome {{name}}</h1>",
      variables: { name: "string", department: "string" },
    });
    expect(body.type).toBe("email");
    expect(body.variables).toHaveProperty("name");
  });

  it("accepts all template types", () => {
    for (const t of ["email", "letter", "certificate"] as const) {
      expect(templateTypeEnum.parse(t)).toBe(t);
    }
  });

  it("rejects invalid template type", () => {
    expect(() => createTemplateBody.parse({ type: "sms", name: "t", htmlBody: "<p>x</p>" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => createTemplateBody.parse({ type: "email", name: "", htmlBody: "<p>x</p>" })).toThrow();
  });

  it("rejects empty htmlBody", () => {
    expect(() => createTemplateBody.parse({ type: "email", name: "Test", htmlBody: "" })).toThrow();
  });
});

/* ─── branding write-via-queue + read-via-cache ──────────────────────── */
describe("branding write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "themes", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();
    queue.subscribe("themes.branding.upsert", async (msg: { payload: { id: string } & Record<string, unknown> }) => {
      store.set(msg.payload.id, msg.payload);
    });
  });

  it("branding command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000010";
    const id = "22222222-bbbb-4000-8000-000000000020";
    const projected = {
      id,
      tenantId,
      logoS3Key: "tenants/t1/logo.png",
      faviconS3Key: null,
      appName: "TestApp",
      primaryColor: "#1e40af",
      accentColor: "#f59e0b",
      footerText: null,
      version: 1,
    };

    await cache.put(cache.makeKey(tenantId, "branding", id), projected);
    await queue.publish("themes.branding.upsert", {
      messageId: id,
      type: "themes.branding.upsert",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "branding", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)).toBeDefined();
  });
});

/* ─── template write-via-queue + read-via-cache ──────────────────────── */
describe("template write-via-queue + read-via-cache", () => {
  let queue: MemoryQueue;
  let cache: Cache;
  const store = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    queue = new MemoryQueue();
    cache = new Cache({ service: "themes", store: new MemoryCache(), defaultTtlSeconds: 60 });
    store.clear();
    queue.subscribe("themes.template.create", async (msg: { payload: { id: string } & Record<string, unknown> }) => {
      store.set(msg.payload.id, msg.payload);
    });
  });

  it("template command primes cache before async DB write", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000030";
    const id = "22222222-bbbb-4000-8000-000000000040";
    const projected = {
      id,
      tenantId,
      type: "email",
      name: "Welcome Email",
      htmlBody: "<h1>Welcome</h1>",
      variables: { name: "string" },
      version: 1,
    };

    await cache.put(cache.makeKey(tenantId, "template", id), projected);
    await queue.publish("themes.template.create", {
      messageId: id,
      type: "themes.template.create",
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c2",
      schemaVersion: "1.0",
      payload: projected,
    });

    expect(store.has(id)).toBe(false);
    const fromCache = await cache.getOrLoad(cache.makeKey(tenantId, "template", id), async () => null);
    expect(fromCache).toEqual(projected);

    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(id)).toBeDefined();
  });

  it("template list results are cached", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000050";
    const page = {
      data: [{ id: "t1", tenantId, type: "letter", name: "Offer Letter", htmlBody: "<p>Offer</p>", variables: null }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    let loads = 0;
    const first = await cache.listOrLoad(tenantId, "template", "list:50:0", async () => { loads++; return page; });
    const second = await cache.listOrLoad(tenantId, "template", "list:50:0", async () => { loads++; return page; });
    expect(first).toEqual(page);
    expect(second).toEqual(page);
    expect(loads).toBe(1);
  });
});
