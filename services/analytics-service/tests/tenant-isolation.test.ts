/**
 * TENANT ISOLATION + IDEMPOTENCY + OPTIMISTIC LOCK — DB-backed behavioural tests.
 * These run against the real civitas_analytics schema (analytics_svc role).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents } from "../src/modules/facts/schema.js";
import { dashboards } from "../src/modules/dashboards/schema.js";
import * as factsRepo from "../src/modules/facts/repo.js";
import * as dashRepo from "../src/modules/dashboards/repo.js";
import { runAggregateQuery, buildAggregateQuery } from "../src/modules/registry/builder.js";
import { querySpecSchema } from "../src/modules/registry/spec.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

async function seedFact(tenantId: string, amount: number, status = "recorded") {
  await factsRepo.ingest(db, {
    tenantId,
    source: "finance",
    eventType: "payment.released",
    category: "general",
    status,
    amount: amount.toFixed(2),
    occurredAt: new Date(),
    dedupeKey: randomUUID(),
  });
}

beforeAll(async () => {
  await seedFact(TENANT_A, 100);
  await seedFact(TENANT_A, 200);
  await seedFact(TENANT_B, 999);
});

afterAll(async () => {
  await db.delete(factEvents).where(eq(factEvents.tenantId, TENANT_A));
  await db.delete(factEvents).where(eq(factEvents.tenantId, TENANT_B));
  await db.delete(dashboards).where(eq(dashboards.tenantId, TENANT_A));
  await sqlClient.end();
});

describe("tenant isolation — a tenant only ever sees its own facts", () => {
  it("sums only tenant A's rows", async () => {
    const spec = querySpecSchema.parse({ metric: "amount_sum", dimensions: [] });
    const res = await runAggregateQuery(db, TENANT_A, spec);
    expect(res.rows[0]?.value).toBe(300);
  });

  it("sums only tenant B's rows (no bleed from A)", async () => {
    const spec = querySpecSchema.parse({ metric: "amount_sum", dimensions: [] });
    const res = await runAggregateQuery(db, TENANT_B, spec);
    expect(res.rows[0]?.value).toBe(999);
  });

  it("a tenant cannot widen its scope via a filter — tenant predicate still wins", async () => {
    // Even if a user filters by another tenant's id-like value on a string field,
    // the mandatory tenant_id predicate confines the scan to their own rows.
    const spec = querySpecSchema.parse({
      metric: "event_count",
      dimensions: [],
      filters: [{ field: "status", op: "eq", value: "recorded" }],
    });
    const a = await runAggregateQuery(db, TENANT_A, spec);
    const b = await runAggregateQuery(db, TENANT_B, spec);
    expect(a.rows[0]?.value).toBe(2);
    expect(b.rows[0]?.value).toBe(1);
    // and the compiled SQL carries the tenant as a bound param
    const { params } = buildAggregateQuery(db, TENANT_A, spec).toSQL();
    expect(params).toContain(TENANT_A);
  });

  it("groups by dimension within the tenant only", async () => {
    const spec = querySpecSchema.parse({ metric: "amount_max", dimensions: ["source"] });
    const res = await runAggregateQuery(db, TENANT_A, spec);
    expect(res.rows).toEqual([{ source: "finance", value: 200 }]);
  });
});

describe("idempotency — redelivered ingestion never double-counts", () => {
  it("ingesting the same (tenant, dedupe_key) twice yields one fact row", async () => {
    const tenant = randomUUID();
    const dedupeKey = randomUUID();
    const row = {
      tenantId: tenant,
      source: "grants",
      eventType: "release.processed",
      category: "general",
      status: "recorded",
      amount: "50.00",
      occurredAt: new Date(),
      dedupeKey,
    };
    await factsRepo.ingest(db, row);
    await factsRepo.ingest(db, row); // duplicate delivery
    const count = await factsRepo.countByTenant(tenant);
    expect(count).toBe(1);
    await db.delete(factEvents).where(eq(factEvents.tenantId, tenant));
  });
});

describe("optimistic locking — stale writes are rejected", () => {
  it("a second update at the same expected version is a no-op (conflict)", async () => {
    const id = randomUUID();
    await dashRepo.insert(db, {
      id,
      tenantId: TENANT_A,
      name: "Lockable",
      description: null,
      status: "active",
      ownerId: ACTOR,
      visibility: "private",
      layout: {},
      createdBy: ACTOR,
      updatedBy: ACTOR,
      version: 1,
    });

    const first = await dashRepo.updateWithVersion(db, id, TENANT_A, 1, { name: "First" }, ACTOR);
    expect(first).toBe(true);

    const afterFirst = await dashRepo.findById(id, TENANT_A);
    expect(afterFirst?.version).toBe(2);
    expect(afterFirst?.name).toBe("First");

    // stale write using the now-outdated version 1
    const conflict = await dashRepo.updateWithVersion(db, id, TENANT_A, 1, { name: "Stale" }, ACTOR);
    expect(conflict).toBe(false);

    const afterConflict = await dashRepo.findById(id, TENANT_A);
    expect(afterConflict?.name).toBe("First"); // unchanged
    expect(afterConflict?.version).toBe(2);
  });

  it("cross-tenant update never matches (tenant-scoped CAS)", async () => {
    const id = randomUUID();
    await dashRepo.insert(db, {
      id,
      tenantId: TENANT_A,
      name: "TenantA only",
      description: null,
      status: "active",
      ownerId: ACTOR,
      visibility: "private",
      layout: {},
      createdBy: ACTOR,
      updatedBy: ACTOR,
      version: 1,
    });
    const wrongTenant = await dashRepo.updateWithVersion(db, id, TENANT_B, 1, { name: "hijack" }, ACTOR);
    expect(wrongTenant).toBe(false);
  });
});
