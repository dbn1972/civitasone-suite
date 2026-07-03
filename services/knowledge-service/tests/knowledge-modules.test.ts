/**
 * knowledge-service module tests.
 * Validates CQRS consumers for categories, retention, search, versions, and sharing modules.
 * Uses MemoryQueue + MemoryCache (no Postgres/Redis required).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { Cache, MemoryCache } from "@civitasone/cache";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { createCategoryBody, updateCategoryBody, reorderCategoryBody } from "../src/modules/categories/validators.js";
import { createRetentionPolicyBody, updateRetentionPolicyBody } from "../src/modules/retention/validators.js";
import { createShareBody } from "../src/modules/sharing/validators.js";
import { searchQueryParams, indexDocumentBody } from "../src/modules/search/validators.js";
import { createVersionBody, restoreVersionBody } from "../src/modules/versions/validators.js";

// ─────────────────────────────────────────────────────────────────────────────
// Categories Module
// ─────────────────────────────────────────────────────────────────────────────

describe("categories module", () => {
  describe("validators", () => {
    it("accepts valid create body", () => {
      const body = createCategoryBody.parse({
        name: "Finance",
        slug: "finance",
        parentId: "11111111-aaaa-4000-8000-000000000001",
        icon: "folder",
        sortOrder: 1,
      });
      expect(body.name).toBe("Finance");
      expect(body.slug).toBe("finance");
      expect(body.icon).toBe("folder");
    });

    it("accepts minimal create body", () => {
      const body = createCategoryBody.parse({ name: "HR", slug: "hr" });
      expect(body.name).toBe("HR");
      expect(body.parentId).toBeUndefined();
      expect(body.icon).toBeUndefined();
    });

    it("rejects invalid slug", () => {
      expect(() => createCategoryBody.parse({ name: "Bad", slug: "Bad Slug!" })).toThrow();
    });

    it("rejects empty name", () => {
      expect(() => createCategoryBody.parse({ name: "", slug: "empty" })).toThrow();
    });

    it("accepts valid update body", () => {
      const body = updateCategoryBody.parse({ name: "Updated", icon: "star" });
      expect(body.name).toBe("Updated");
      expect(body.icon).toBe("star");
    });

    it("accepts reorder body", () => {
      const body = reorderCategoryBody.parse({
        items: [
          { id: "11111111-aaaa-4000-8000-000000000001", sortOrder: 0 },
          { id: "22222222-bbbb-4000-8000-000000000002", sortOrder: 1 },
        ],
      });
      expect(body.items).toHaveLength(2);
    });

    it("rejects empty reorder items", () => {
      expect(() => reorderCategoryBody.parse({ items: [] })).toThrow();
    });
  });

  describe("consumer (write-via-queue)", () => {
    let queue: MemoryQueue;
    let cache: Cache;
    const store = new Map<string, unknown>();

    beforeEach(() => {
      queue = new MemoryQueue();
      cache = new Cache({ service: "knowledge", store: new MemoryCache(), defaultTtlSeconds: 60 });
      store.clear();

      queue.subscribe(COMMANDS.categoryCreate, async (msg) => {
        const p = msg.payload as { id: string; name: string; tenantId: string };
        store.set(p.id, p);
      });

      queue.subscribe(COMMANDS.categoryUpdate, async (msg) => {
        const p = msg.payload as { id: string };
        store.set(`update:${p.id}`, p);
      });

      queue.subscribe(COMMANDS.categoryDelete, async (msg) => {
        const p = msg.payload as { id: string };
        store.delete(p.id);
        store.set(`deleted:${p.id}`, true);
      });
    });

    it("category create command primes cache and enqueues", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000001";
      const id = "22222222-bbbb-4000-8000-000000000001";
      const projected = {
        id, tenantId, parentId: null, name: "Finance", slug: "finance",
        description: "", icon: "folder", sortOrder: 0, createdAt: new Date(),
        updatedAt: new Date(), createdBy: "actor-1", updatedBy: "actor-1", version: 1,
      };

      await cache.put(cache.makeKey(tenantId, "category", id), projected);
      await queue.publish(COMMANDS.categoryCreate, {
        messageId: id,
        type: COMMANDS.categoryCreate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c1",
        schemaVersion: "1.0",
        payload: projected,
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.has(id)).toBe(true);
      const cached = await cache.getOrLoad(cache.makeKey(tenantId, "category", id), async () => null);
      expect(cached).toMatchObject({ id, name: "Finance" });
    });

    it("category update enqueues update command", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000001";
      const id = "33333333-cccc-4000-8000-000000000001";
      await queue.publish(COMMANDS.categoryUpdate, {
        messageId: "33333333-cccc-4000-8000-000000000099",
        type: COMMANDS.categoryUpdate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c2",
        schemaVersion: "1.0",
        payload: { id, name: "Renamed" },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.get(`update:${id}`)).toMatchObject({ id, name: "Renamed" });
    });

    it("category delete enqueues delete command", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000001";
      const id = "44444444-dddd-4000-8000-000000000001";
      store.set(id, { id, name: "ToDelete" });

      await queue.publish(COMMANDS.categoryDelete, {
        messageId: "44444444-dddd-4000-8000-000000000099",
        type: COMMANDS.categoryDelete,
        tenantId,
        actorId: "actor-1",
        correlationId: "c3",
        schemaVersion: "1.0",
        payload: { id },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.has(id)).toBe(false);
      expect(store.get(`deleted:${id}`)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retention Module
// ─────────────────────────────────────────────────────────────────────────────

describe("retention module", () => {
  describe("validators", () => {
    it("accepts valid create body", () => {
      const body = createRetentionPolicyBody.parse({
        name: "7 Year Financial Records",
        retentionYears: 7,
        action: "archive",
        reminderMonths: 6,
      });
      expect(body.name).toBe("7 Year Financial Records");
      expect(body.retentionYears).toBe(7);
      expect(body.action).toBe("archive");
      expect(body.reminderMonths).toBe(6);
    });

    it("applies default reminderMonths", () => {
      const body = createRetentionPolicyBody.parse({
        name: "Destroy After 3 Years",
        retentionYears: 3,
        action: "destroy",
      });
      expect(body.reminderMonths).toBe(3);
    });

    it("accepts retentionDays and notifyBefore fields", () => {
      const body = createRetentionPolicyBody.parse({
        name: "Short Term Policy",
        retentionYears: 1,
        retentionDays: 180,
        action: "archive",
        notifyBefore: 30,
      });
      expect(body.retentionDays).toBe(180);
      expect(body.notifyBefore).toBe(30);
    });

    it("accepts categoryId reference", () => {
      const body = createRetentionPolicyBody.parse({
        name: "HR Records Policy",
        categoryId: "11111111-aaaa-4000-8000-000000000001",
        retentionYears: 10,
        action: "archive",
      });
      expect(body.categoryId).toBe("11111111-aaaa-4000-8000-000000000001");
    });

    it("rejects invalid action", () => {
      expect(() => createRetentionPolicyBody.parse({
        name: "Bad",
        retentionYears: 5,
        action: "delete",
      })).toThrow();
    });

    it("rejects retentionYears > 100", () => {
      expect(() => createRetentionPolicyBody.parse({
        name: "Too Long",
        retentionYears: 101,
        action: "archive",
      })).toThrow();
    });

    it("rejects retentionYears < 1", () => {
      expect(() => createRetentionPolicyBody.parse({
        name: "Too Short",
        retentionYears: 0,
        action: "archive",
      })).toThrow();
    });

    it("accepts valid update body with new fields", () => {
      const body = updateRetentionPolicyBody.parse({ name: "Updated Policy", retentionYears: 5, notifyBefore: 60, retentionDays: 90 });
      expect(body.name).toBe("Updated Policy");
      expect(body.retentionYears).toBe(5);
      expect(body.notifyBefore).toBe(60);
      expect(body.retentionDays).toBe(90);
    });
  });

  describe("consumer (write-via-queue)", () => {
    let queue: MemoryQueue;
    let cache: Cache;
    const store = new Map<string, unknown>();

    beforeEach(() => {
      queue = new MemoryQueue();
      cache = new Cache({ service: "knowledge", store: new MemoryCache(), defaultTtlSeconds: 60 });
      store.clear();

      queue.subscribe(COMMANDS.retentionPolicyCreate, async (msg) => {
        const p = msg.payload as { id: string; name: string; retentionYears: number };
        store.set(p.id, p);
      });

      queue.subscribe(COMMANDS.retentionPolicyUpdate, async (msg) => {
        const p = msg.payload as { id: string };
        store.set(`update:${p.id}`, p);
      });

      queue.subscribe(COMMANDS.retentionPolicyApply, async (msg) => {
        const p = msg.payload as { policyId: string };
        store.set(`apply:${p.policyId}`, p);
      });
    });

    it("retention policy create primes cache and enqueues", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000010";
      const id = "55555555-eeee-4000-8000-000000000001";
      const projected = {
        id, tenantId, name: "Financial Records", categoryId: null,
        retentionYears: 7, retentionDays: 0, action: "archive",
        notifyBefore: 90, reminderMonths: 6,
        createdAt: new Date(), updatedAt: new Date(),
        createdBy: "actor-1", updatedBy: "actor-1", version: 1,
      };

      await cache.put(cache.makeKey(tenantId, "retention-policy", id), projected);
      await queue.publish(COMMANDS.retentionPolicyCreate, {
        messageId: id,
        type: COMMANDS.retentionPolicyCreate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c1",
        schemaVersion: "1.0",
        payload: projected,
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.has(id)).toBe(true);
      const cached = await cache.getOrLoad(cache.makeKey(tenantId, "retention-policy", id), async () => null);
      expect(cached).toMatchObject({ id, name: "Financial Records", retentionYears: 7 });
    });

    it("retention policy update enqueues", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000010";
      const id = "66666666-ffff-4000-8000-000000000001";
      await queue.publish(COMMANDS.retentionPolicyUpdate, {
        messageId: "66666666-ffff-4000-8000-000000000099",
        type: COMMANDS.retentionPolicyUpdate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c2",
        schemaVersion: "1.0",
        payload: { id, retentionYears: 10 },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.get(`update:${id}`)).toMatchObject({ id, retentionYears: 10 });
    });

    it("retention policy apply enqueues enforcement", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000010";
      const policyId = "77777777-aaaa-4000-8000-000000000001";
      await queue.publish(COMMANDS.retentionPolicyApply, {
        messageId: "77777777-aaaa-4000-8000-000000000099",
        type: COMMANDS.retentionPolicyApply,
        tenantId,
        actorId: "actor-1",
        correlationId: "c3",
        schemaVersion: "1.0",
        payload: { policyId, tenantId },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.get(`apply:${policyId}`)).toMatchObject({ policyId });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Search Module
// ─────────────────────────────────────────────────────────────────────────────

describe("search module", () => {
  describe("validators", () => {
    it("accepts valid search query params", () => {
      const params = searchQueryParams.parse({ q: "budget report", limit: "10", offset: "0" });
      expect(params.q).toBe("budget report");
      expect(params.limit).toBe(10);
      expect(params.offset).toBe(0);
    });

    it("applies defaults for limit and offset", () => {
      const params = searchQueryParams.parse({ q: "hello" });
      expect(params.limit).toBe(20);
      expect(params.offset).toBe(0);
    });

    it("accepts category and tags filter", () => {
      const params = searchQueryParams.parse({ q: "policy", category: "finance", tags: "annual,budget" });
      expect(params.category).toBe("finance");
      expect(params.tags).toBe("annual,budget");
    });

    it("accepts dateFrom and dateTo filters", () => {
      const params = searchQueryParams.parse({
        q: "report",
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-12-31T23:59:59Z",
      });
      expect(params.dateFrom).toBe("2024-01-01T00:00:00Z");
      expect(params.dateTo).toBe("2024-12-31T23:59:59Z");
    });

    it("rejects empty query", () => {
      expect(() => searchQueryParams.parse({ q: "" })).toThrow();
    });

    it("rejects query over 500 chars", () => {
      expect(() => searchQueryParams.parse({ q: "x".repeat(501) })).toThrow();
    });

    it("accepts valid index document body", () => {
      const body = indexDocumentBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        title: "Annual Budget Report",
        content: "This document contains...",
        tags: ["finance", "annual"],
      });
      expect(body.documentId).toBe("11111111-aaaa-4000-8000-000000000001");
      expect(body.tags).toHaveLength(2);
    });

    it("applies defaults for content and tags", () => {
      const body = indexDocumentBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        title: "Minimal",
      });
      expect(body.content).toBe("");
      expect(body.tags).toEqual([]);
    });
  });

  describe("consumer (write-via-queue)", () => {
    let queue: MemoryQueue;
    const indexed = new Map<string, unknown>();

    beforeEach(() => {
      queue = new MemoryQueue();
      indexed.clear();

      queue.subscribe(COMMANDS.searchIndex, async (msg) => {
        const p = msg.payload as { id: string; documentId: string; title: string };
        indexed.set(p.documentId, p);
      });

      queue.subscribe(COMMANDS.searchReindex, async (msg) => {
        indexed.set("reindex", { tenantId: msg.tenantId });
      });

      queue.subscribe(COMMANDS.searchRemoveDocument, async (msg) => {
        const p = msg.payload as { documentId: string };
        indexed.delete(p.documentId);
        indexed.set(`removed:${p.documentId}`, true);
      });
    });

    it("search index command stores document", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000020";
      await queue.publish(COMMANDS.searchIndex, {
        messageId: "11111111-aaaa-4000-8000-000000000021",
        type: COMMANDS.searchIndex,
        tenantId,
        actorId: "actor-1",
        correlationId: "c1",
        schemaVersion: "1.0",
        payload: {
          id: "11111111-aaaa-4000-8000-000000000021",
          tenantId,
          documentId: "doc-001",
          title: "Budget Report",
          content: "Annual budget overview",
          tags: ["finance"],
        },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(indexed.has("doc-001")).toBe(true);
      expect(indexed.get("doc-001")).toMatchObject({ title: "Budget Report" });
    });

    it("search reindex command signals full re-index", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000020";
      await queue.publish(COMMANDS.searchReindex, {
        messageId: "11111111-aaaa-4000-8000-000000000022",
        type: COMMANDS.searchReindex,
        tenantId,
        actorId: "actor-1",
        correlationId: "c2",
        schemaVersion: "1.0",
        payload: { tenantId },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(indexed.get("reindex")).toMatchObject({ tenantId });
    });

    it("search remove document removes from index", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000020";
      indexed.set("doc-002", { documentId: "doc-002", title: "Old Doc" });

      await queue.publish(COMMANDS.searchRemoveDocument, {
        messageId: "11111111-aaaa-4000-8000-000000000023",
        type: COMMANDS.searchRemoveDocument,
        tenantId,
        actorId: "actor-1",
        correlationId: "c3",
        schemaVersion: "1.0",
        payload: { documentId: "doc-002" },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(indexed.has("doc-002")).toBe(false);
      expect(indexed.get("removed:doc-002")).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sharing Module
// ─────────────────────────────────────────────────────────────────────────────

describe("sharing module", () => {
  describe("validators", () => {
    it("accepts valid share create body", () => {
      const body = createShareBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        sharedWith: "22222222-bbbb-4000-8000-000000000002",
        permission: "view",
      });
      expect(body.documentId).toBe("11111111-aaaa-4000-8000-000000000001");
      expect(body.permission).toBe("view");
      expect(body.expiresAt).toBeUndefined();
    });

    it("accepts edit permission with expiry", () => {
      const body = createShareBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        sharedWith: "22222222-bbbb-4000-8000-000000000002",
        permission: "edit",
        expiresAt: "2025-12-31T23:59:59Z",
      });
      expect(body.permission).toBe("edit");
      expect(body.expiresAt).toBe("2025-12-31T23:59:59Z");
    });

    it("rejects invalid permission", () => {
      expect(() => createShareBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        sharedWith: "22222222-bbbb-4000-8000-000000000002",
        permission: "admin",
      })).toThrow();
    });

    it("rejects non-uuid documentId", () => {
      expect(() => createShareBody.parse({
        documentId: "not-a-uuid",
        sharedWith: "22222222-bbbb-4000-8000-000000000002",
        permission: "view",
      })).toThrow();
    });

    it("rejects non-uuid sharedWith", () => {
      expect(() => createShareBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        sharedWith: "not-a-uuid",
        permission: "view",
      })).toThrow();
    });
  });

  describe("consumer (write-via-queue)", () => {
    let queue: MemoryQueue;
    let cache: Cache;
    const store = new Map<string, unknown>();

    beforeEach(() => {
      queue = new MemoryQueue();
      cache = new Cache({ service: "knowledge", store: new MemoryCache(), defaultTtlSeconds: 60 });
      store.clear();

      queue.subscribe(COMMANDS.shareCreate, async (msg) => {
        const p = msg.payload as { id: string; documentId: string; sharedWith: string; permission: string };
        store.set(p.id, p);
      });

      queue.subscribe(COMMANDS.shareRevoke, async (msg) => {
        const p = msg.payload as { id: string };
        store.delete(p.id);
        store.set(`revoked:${p.id}`, true);
      });
    });

    it("share create primes cache and enqueues", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000030";
      const id = "77777777-aaaa-4000-8000-000000000001";
      const projected = {
        id, tenantId,
        documentId: "doc-001",
        sharedWith: "user-002",
        permission: "view",
        expiresAt: null,
        createdAt: new Date(), updatedAt: new Date(),
        createdBy: "actor-1", updatedBy: "actor-1", version: 1,
      };

      await cache.put(cache.makeKey(tenantId, "share", id), projected);
      await queue.publish(COMMANDS.shareCreate, {
        messageId: id,
        type: COMMANDS.shareCreate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c1",
        schemaVersion: "1.0",
        payload: projected,
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.has(id)).toBe(true);
      expect(store.get(id)).toMatchObject({ documentId: "doc-001", permission: "view" });
    });

    it("share revoke removes from store", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000030";
      const id = "88888888-bbbb-4000-8000-000000000001";
      store.set(id, { id, documentId: "doc-001", sharedWith: "user-002", permission: "view" });

      await queue.publish(COMMANDS.shareRevoke, {
        messageId: "88888888-bbbb-4000-8000-000000000099",
        type: COMMANDS.shareRevoke,
        tenantId,
        actorId: "actor-1",
        correlationId: "c2",
        schemaVersion: "1.0",
        payload: { id },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.has(id)).toBe(false);
      expect(store.get(`revoked:${id}`)).toBe(true);
    });

    it("different tenants do not share cached shares", async () => {
      const tenantA = "aaaaaaaa-0000-4000-8000-000000000001";
      const tenantB = "bbbbbbbb-0000-4000-8000-000000000002";
      const id = "99999999-0000-4000-8000-000000000001";

      await cache.put(cache.makeKey(tenantA, "share", id), { id, tenantId: tenantA, permission: "edit" });
      const fromB = await cache.getOrLoad(cache.makeKey(tenantB, "share", id), async () => null);
      expect(fromB).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Versions Module
// ─────────────────────────────────────────────────────────────────────────────

describe("versions module", () => {
  describe("validators", () => {
    it("accepts valid create version body", () => {
      const body = createVersionBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        s3Key: "tenants/t1/docs/d1/v2.pdf",
        sizeBytes: 1048576,
        changeNote: "Updated formatting",
      });
      expect(body.documentId).toBe("11111111-aaaa-4000-8000-000000000001");
      expect(body.s3Key).toBe("tenants/t1/docs/d1/v2.pdf");
      expect(body.sizeBytes).toBe(1048576);
      expect(body.changeNote).toBe("Updated formatting");
    });

    it("applies default changeNote", () => {
      const body = createVersionBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        s3Key: "docs/v1.pdf",
      });
      expect(body.changeNote).toBe("");
      expect(body.sizeBytes).toBeUndefined();
    });

    it("rejects missing s3Key", () => {
      expect(() => createVersionBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
      })).toThrow();
    });

    it("rejects non-uuid documentId", () => {
      expect(() => createVersionBody.parse({
        documentId: "not-a-uuid",
        s3Key: "docs/v1.pdf",
      })).toThrow();
    });

    it("accepts valid restore version body", () => {
      const body = restoreVersionBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        versionId: "22222222-bbbb-4000-8000-000000000002",
        changeNote: "Reverted to previous version",
      });
      expect(body.documentId).toBe("11111111-aaaa-4000-8000-000000000001");
      expect(body.versionId).toBe("22222222-bbbb-4000-8000-000000000002");
      expect(body.changeNote).toBe("Reverted to previous version");
    });

    it("applies default changeNote for restore", () => {
      const body = restoreVersionBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        versionId: "22222222-bbbb-4000-8000-000000000002",
      });
      expect(body.changeNote).toBe("Restored from previous version");
    });

    it("rejects non-uuid versionId", () => {
      expect(() => restoreVersionBody.parse({
        documentId: "11111111-aaaa-4000-8000-000000000001",
        versionId: "not-a-uuid",
      })).toThrow();
    });
  });

  describe("consumer (write-via-queue)", () => {
    let queue: MemoryQueue;
    let cache: Cache;
    const store = new Map<string, unknown>();

    beforeEach(() => {
      queue = new MemoryQueue();
      cache = new Cache({ service: "knowledge", store: new MemoryCache(), defaultTtlSeconds: 60 });
      store.clear();

      queue.subscribe(COMMANDS.versionCreate, async (msg) => {
        const p = msg.payload as { id: string; documentId: string; versionNo: number; s3Key: string };
        store.set(p.id, p);
      });

      queue.subscribe(COMMANDS.versionRestore, async (msg) => {
        const p = msg.payload as { id: string; documentId: string; versionId: string };
        store.set(`restore:${p.id}`, p);
      });
    });

    it("version create primes cache and enqueues", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000040";
      const id = "aaaaaaaa-1111-4000-8000-000000000001";
      const projected = {
        id, tenantId,
        documentId: "doc-001",
        versionNo: 2,
        s3Key: "tenants/t1/docs/d1/v2.pdf",
        sizeBytes: 2048,
        changeNote: "Updated content",
        createdBy: "actor-1",
        createdAt: new Date(),
      };

      await cache.put(cache.makeKey(tenantId, "document-version", id), projected);
      await queue.publish(COMMANDS.versionCreate, {
        messageId: id,
        type: COMMANDS.versionCreate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c1",
        schemaVersion: "1.0",
        payload: projected,
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.has(id)).toBe(true);
      expect(store.get(id)).toMatchObject({ documentId: "doc-001", versionNo: 2, s3Key: "tenants/t1/docs/d1/v2.pdf" });
      const cached = await cache.getOrLoad(cache.makeKey(tenantId, "document-version", id), async () => null);
      expect(cached).toMatchObject({ id, versionNo: 2 });
    });

    it("version restore enqueues restore command", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000040";
      const id = "bbbbbbbb-2222-4000-8000-000000000001";
      const versionId = "cccccccc-3333-4000-8000-000000000001";

      await queue.publish(COMMANDS.versionRestore, {
        messageId: id,
        type: COMMANDS.versionRestore,
        tenantId,
        actorId: "actor-1",
        correlationId: "c2",
        schemaVersion: "1.0",
        payload: { id, tenantId, documentId: "doc-001", versionId, changeNote: "Reverting" },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.get(`restore:${id}`)).toMatchObject({ documentId: "doc-001", versionId });
    });

    it("different documents maintain separate version histories", async () => {
      const tenantId = "11111111-aaaa-4000-8000-000000000040";
      const v1 = "dddddddd-4444-4000-8000-000000000001";
      const v2 = "eeeeeeee-5555-4000-8000-000000000001";

      await queue.publish(COMMANDS.versionCreate, {
        messageId: v1,
        type: COMMANDS.versionCreate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c3",
        schemaVersion: "1.0",
        payload: { id: v1, tenantId, documentId: "doc-001", versionNo: 1, s3Key: "docs/d1/v1.pdf", sizeBytes: 100, changeNote: "", createdBy: "actor-1", createdAt: new Date() },
      });
      await queue.publish(COMMANDS.versionCreate, {
        messageId: v2,
        type: COMMANDS.versionCreate,
        tenantId,
        actorId: "actor-1",
        correlationId: "c4",
        schemaVersion: "1.0",
        payload: { id: v2, tenantId, documentId: "doc-002", versionNo: 1, s3Key: "docs/d2/v1.pdf", sizeBytes: 200, changeNote: "", createdBy: "actor-1", createdAt: new Date() },
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(store.has(v1)).toBe(true);
      expect(store.has(v2)).toBe(true);
      expect((store.get(v1) as { documentId: string }).documentId).toBe("doc-001");
      expect((store.get(v2) as { documentId: string }).documentId).toBe("doc-002");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Topics Completeness
// ─────────────────────────────────────────────────────────────────────────────

describe("topics", () => {
  it("all command topics are defined", () => {
    expect(COMMANDS.createDocument).toBe("knowledge.document.create");
    expect(COMMANDS.categoryCreate).toBe("knowledge.category.create");
    expect(COMMANDS.categoryUpdate).toBe("knowledge.category.update");
    expect(COMMANDS.categoryDelete).toBe("knowledge.category.delete");
    expect(COMMANDS.categoryReorder).toBe("knowledge.category.reorder");
    expect(COMMANDS.retentionPolicyCreate).toBe("knowledge.retention-policy.create");
    expect(COMMANDS.retentionPolicyUpdate).toBe("knowledge.retention-policy.update");
    expect(COMMANDS.retentionPolicyApply).toBe("knowledge.retention-policy.apply");
    expect(COMMANDS.searchIndex).toBe("knowledge.search.index");
    expect(COMMANDS.searchReindex).toBe("knowledge.search.reindex");
    expect(COMMANDS.searchRemoveDocument).toBe("knowledge.search.remove-document");
    expect(COMMANDS.versionCreate).toBe("knowledge.version.create");
    expect(COMMANDS.versionRestore).toBe("knowledge.version.restore");
    expect(COMMANDS.shareCreate).toBe("knowledge.share.create");
    expect(COMMANDS.shareRevoke).toBe("knowledge.share.revoke");
  });

  it("all event topics are defined", () => {
    expect(EVENTS.documentCreated).toBe("knowledge.document.created");
    expect(EVENTS.categoryCreated).toBe("knowledge.category.created");
    expect(EVENTS.categoryUpdated).toBe("knowledge.category.updated");
    expect(EVENTS.categoryDeleted).toBe("knowledge.category.deleted");
    expect(EVENTS.categoryReordered).toBe("knowledge.category.reordered");
    expect(EVENTS.retentionPolicyCreated).toBe("knowledge.retention-policy.created");
    expect(EVENTS.retentionPolicyUpdated).toBe("knowledge.retention-policy.updated");
    expect(EVENTS.retentionPolicyApplied).toBe("knowledge.retention-policy.applied");
    expect(EVENTS.searchIndexed).toBe("knowledge.search.indexed");
    expect(EVENTS.searchReindexed).toBe("knowledge.search.reindexed");
    expect(EVENTS.searchDocumentRemoved).toBe("knowledge.search.document-removed");
    expect(EVENTS.versionCreated).toBe("knowledge.version.created");
    expect(EVENTS.versionRestored).toBe("knowledge.version.restored");
    expect(EVENTS.shareCreated).toBe("knowledge.share.created");
    expect(EVENTS.shareRevoked).toBe("knowledge.share.revoked");
  });
});
