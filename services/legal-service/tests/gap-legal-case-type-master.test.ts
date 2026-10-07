/**
 * GAP-LEGAL-CASES-NEW-01 — legal case-type master.
 *
 * Builds the previously-missing backend capability: a tenant-scoped case-type
 * master (code → name) with a list endpoint (feeds the create-case select), an
 * admin create endpoint, and an idempotent seed-defaults endpoint — each going
 * through the CQRS command → consumer → DB + audit path.
 *
 * REAL Postgres (localhost:5672), QUEUE_DRIVER=memory. The route tests drive
 * the HTTP stack via app.inject; the consumer tests drive the real consumer on
 * a MemoryQueue (same pattern as consumers-coverage.test.ts) and assert the DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { legalCaseTypes } from "../src/modules/cases/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerCaseConsumers } from "../src/modules/cases/consumer.js";
import * as caseQueries from "../src/modules/cases/queries.js";
import { cache } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-00000000c001";
const ACTOR = "00000000-aaaa-4000-8000-00000000c001";
const MSG_CREATE = "cccccccc-1111-4000-8000-00000000c0c1";
const MSG_SEED = "cccccccc-2222-4000-8000-00000000c0c2";

function makeToken(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-ct" }, JWT_SECRET, 3600);
}
async function buildApp() {
  const { buildApp } = await import("../src/app.js");
  return buildApp();
}
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 300));
}
async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalCaseTypes).where(eq(legalCaseTypes.tenantId, TENANT));
    // Deterministic messageIds are inbox-deduped, so clear their processed
    // markers or a re-run silently no-ops the writes.
    for (const mid of [MSG_CREATE, MSG_SEED]) {
      await tx.delete(processed).where(eq(processed.messageId, mid));
    }
  }));
  await cache.invalidateResource(TENANT, "case_types");
}

beforeAll(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("case-type master routes (GAP-LEGAL-CASES-NEW-01)", () => {
  it("GET /v1/legal/case-types lists seeded types for the tenant", async () => {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(legalCaseTypes).values({
      tenantId: TENANT, code: "writ", name: "Writ Petition", createdBy: ACTOR, updatedBy: ACTOR,
    })));
    await cache.invalidateResource(TENANT, "case_types");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/legal/case-types",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string; code: string; name: string }>;
    expect(items.some((t) => t.code === "writ" && t.name === "Writ Petition")).toBe(true);
    await app.close();
  });

  it("POST /v1/legal/case-types requires an admin role (403 for legal_officer)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/legal/case-types",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}`, "x-tenant-id": TENANT },
      payload: { code: "pil", name: "Public Interest Litigation" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /v1/legal/case-types accepts a new type as admin (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/legal/case-types",
      headers: { authorization: `Bearer ${makeToken(["legal_admin"])}`, "x-tenant-id": TENANT },
      payload: { code: "tax", name: "Tax Matter" },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });

  it("POST /v1/legal/case-types rejects a duplicate code (409)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/legal/case-types",
      headers: { authorization: `Bearer ${makeToken(["legal_admin"])}`, "x-tenant-id": TENANT },
      payload: { code: "writ", name: "Writ (dup)" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CASE_TYPE_CODE");
    await app.close();
  });

  it("POST /v1/legal/case-types/seed-defaults requires admin (403 for legal_officer)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/legal/case-types/seed-defaults",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /v1/legal/cases with an unknown caseTypeId is rejected (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases",
      headers: { authorization: `Bearer ${makeToken(["legal_officer"])}`, "x-tenant-id": TENANT },
      payload: { caseNo: "WP/CT/9999", title: "Bad type", court: "HC", caseTypeId: "99999999-9999-4999-8999-999999999999" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("UNKNOWN_CASE_TYPE");
    await app.close();
  });
});

describe("case-type master consumer (GAP-LEGAL-CASES-NEW-01)", () => {
  it("caseTypeCreate persists the type + emits an audit event", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerCaseConsumers(q);
    await q.start();
    await q.publish(COMMANDS.caseTypeCreate, {
      messageId: MSG_CREATE, type: COMMANDS.caseTypeCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c-ct-1", schemaVersion: "1.0",
      payload: { id: "aaaaaaaa-1111-4000-8000-00000000c0a1", tenantId: TENANT, code: "appeal", name: "Appeal" },
    });
    await drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(legalCaseTypes).where(eq(legalCaseTypes.tenantId, TENANT))));
    expect(rows.some((r) => r.code === "appeal" && r.name === "Appeal")).toBe(true);
    const outbox = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(outbox.some((m) => (m.payload as { resourceType?: string }).resourceType === "case_type")).toBe(true);
    await q.stop();
  });

  it("caseTypeSeedDefaults installs the baseline idempotently", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerCaseConsumers(q);
    await q.start();
    // First seed.
    await q.publish(COMMANDS.caseTypeSeedDefaults, {
      messageId: MSG_SEED, type: COMMANDS.caseTypeSeedDefaults,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c-seed", schemaVersion: "1.0",
      payload: { tenantId: TENANT },
    });
    await drain();
    await cache.invalidateResource(TENANT, "case_types");
    const types = await runWithTenant(TENANT, () => caseQueries.listCaseTypes(TENANT));
    for (const code of ["writ", "civil", "criminal", "arbitration", "service", "other"]) {
      expect(types.some((t) => t.code === code)).toBe(true);
    }
    const countAfterFirst = types.length;

    // Re-publish the SAME seed messageId — markProcessed dedups it to a no-op.
    const q2 = wireTenantAwareQueue(new MemoryQueue());
    registerCaseConsumers(q2);
    await q2.start();
    await q2.publish(COMMANDS.caseTypeSeedDefaults, {
      messageId: MSG_SEED, type: COMMANDS.caseTypeSeedDefaults,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c-seed-2", schemaVersion: "1.0",
      payload: { tenantId: TENANT },
    });
    await drain();
    await cache.invalidateResource(TENANT, "case_types");
    const typesAgain = await runWithTenant(TENANT, () => caseQueries.listCaseTypes(TENANT));
    expect(typesAgain.length).toBe(countAfterFirst);
    await q.stop();
    await q2.stop();
  });
});
