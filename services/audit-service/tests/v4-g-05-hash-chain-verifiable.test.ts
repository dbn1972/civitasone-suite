/**
 * V4-G-05: the audit hash chain must be re-verifiable from STORED rows.
 * The hashed timestamp must be the persisted occurred_at, and the payload digest
 * must be insensitive to jsonb key reordering.
 */
import { describe, it, expect, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { auditEvents } from "../src/modules/events/schema.js";
import { writeEvent, verifyTenantChain } from "../src/modules/events/repo.js";
import { registerAuditConsumers } from "../src/modules/events/consumer.js";
import { computeHash, canonicalJson, nextOccurredAt, verifyChain, type ChainRow } from "../src/modules/events/domain.js";

const TENANT = globalThis.crypto.randomUUID();
const ACTOR = globalThis.crypto.randomUUID();

afterAll(async () => {
  await sqlClient.end();
});

async function storedRows() {
  return runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT)).orderBy(asc(auditEvents.occurredAt)),
    ),
  );
}

describe("V4-G-05 audit chain is re-verifiable from stored rows", () => {
  it("event_hash is reproducible from occurred_at + stored (jsonb) actor/target/payload", async () => {
    // Keys deliberately NOT in sorted order, nested too: jsonb reorders them on read-back.
    await runWithTenant(TENANT, () =>
      writeEvent(TENANT, ACTOR, "v4.test.one", "thing", "res-1", "info",
        { zebra: 1, alpha: { yy: 2, xx: [3, { b: 1, a: 2 }] }, middlekey: "m" }, "corr-1"),
    );
    await runWithTenant(TENANT, () =>
      writeEvent(TENANT, ACTOR, "v4.test.two", "thing", "res-2", "info", { b: 1, a: 2 }, "corr-2"),
    );
    const rows = await storedRows();
    expect(rows).toHaveLength(2);
    let prev: string | null = null;
    for (const r of rows) {
      expect(r.prevHash).toBe(prev);
      const recomputed = computeHash(r.id, r.tenantId, r.type, r.prevHash, r.occurredAt.toISOString(), {
        actor: r.actor, target: r.target, payload: r.payload,
      });
      expect(recomputed).toBe(r.eventHash);
      prev = r.eventHash;
    }
  });

  it("verifyTenantChain accepts the untouched chain", async () => {
    const v = await verifyTenantChain(TENANT);
    expect(v).toEqual({ ok: true, checked: 2, linkBreaks: [], hashMismatches: [] });
  });

  it("consumer path persists the hashed instant and the chain stays verifiable", async () => {
    const tenant = globalThis.crypto.randomUUID();
    const q: Queue = new MemoryQueue();
    const raw = q.subscribe.bind(q);
    q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
    registerAuditConsumers(q);
    await q.start();
    for (let i = 0; i < 3; i++) {
      await q.publish("audit.event.record", {
        messageId: globalThis.crypto.randomUUID(), type: "audit.event.record", tenantId: tenant, actorId: ACTOR,
        correlationId: globalThis.crypto.randomUUID(), schemaVersion: "1.0",
        payload: { outcome: "success", action: "x", service: "svc", resourceType: "t", resourceId: `r${i}`, zeta: i, alpha: { y: 1, x: 2 } },
      });
    }
    for (let i = 0; i < 50; i++) {
      const n = (await runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, tenant))))).length;
      if (n >= 3) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await q.stop();
    const v = await verifyTenantChain(tenant);
    expect(v).toEqual({ ok: true, checked: 3, linkBreaks: [], hashMismatches: [] });
  });
});

describe("V4-G-05 verifier + helpers (pure)", () => {
  const T = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const mk = (id: string, prev: string | null, at: string, payload: unknown): ChainRow => ({
    id, tenantId: T, type: "t", actor: { actorId: "u" }, target: "x", payload, prevHash: prev, occurredAt: at,
    eventHash: computeHash(id, T, "t", prev, at, { actor: { actorId: "u" }, target: "x", payload }),
  });

  it("canonicalJson is independent of key order at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: [{ y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });

  it("verifyChain detects payload tamper, hash tamper and a broken link", () => {
    const e1 = mk("e1", null, "2026-10-01T00:00:00.000Z", { v: 1 });
    const e2 = mk("e2", e1.eventHash, "2026-10-01T00:00:00.001Z", { v: 2 });
    const e3 = mk("e3", e2.eventHash, "2026-10-01T00:00:00.002Z", { v: 3 });
    expect(verifyChain([e1, e2, e3]).ok).toBe(true);
    expect(verifyChain([e1, { ...e2, payload: { v: 99 } }, e3]).hashMismatches).toEqual(["e2"]);
    expect(verifyChain([e1, { ...e2, occurredAt: "2026-10-01T00:00:00.009Z" }, e3]).hashMismatches).toEqual(["e2"]);
    expect(verifyChain([e1, e3]).linkBreaks).toEqual(["e3"]);
  });

  it("nextOccurredAt is strictly after the previous link", () => {
    expect(nextOccurredAt(null, 1000).getTime()).toBe(1000);
    expect(nextOccurredAt(new Date(1000).toISOString(), 1000).getTime()).toBe(1001);
    expect(nextOccurredAt(new Date(5000).toISOString(), 1000).getTime()).toBe(5001);
    expect(nextOccurredAt(new Date(500).toISOString(), 1000).getTime()).toBe(1000);
  });
});
