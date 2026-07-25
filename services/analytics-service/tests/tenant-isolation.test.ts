/**
 * TENANT ISOLATION + IDEMPOTENCY + OPTIMISTIC LOCK — DB-backed behavioural tests.
 * These run against the real civitas_analytics schema under the analytics_svc
 * role, which is NOBYPASSRLS: every fact_events / dashboards read AND write is
 * enforced by the `tenant_isolation` RLS policy
 * (tenant_id = current_setting('app.tenant_id')). We therefore drive every DB op
 * through the SAME tenant-context path production uses — runWithTenant(tenantId)
 * + db.transaction / scopedRead — so wrapWithTenantGuc sets app.tenant_id inside
 * each transaction (mirrors worker.ts + the module consumers). A read issued for
 * tenant A can only ever see A's rows: if either the RLS policy OR the builder's
 * mandatory tenant predicate regressed, these sums would bleed and fail.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead, sqlClient } from "../src/shared/db.js";
import { markProcessed } from "../src/shared/outbox.js";
import { factEvents } from "../src/modules/facts/schema.js";
import { dashboards } from "../src/modules/dashboards/schema.js";
import * as factsRepo from "../src/modules/facts/repo.js";
import * as dashRepo from "../src/modules/dashboards/repo.js";
import { runAggregateQuery, buildAggregateQuery } from "../src/modules/registry/builder.js";
import { querySpecSchema, type QuerySpec } from "../src/modules/registry/spec.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

/**
 * Ingest a fact exactly the way the production consumer does: inside the tenant's
 * GUC context + a write transaction. `amount` is a minor-unit BIGINT (never a
 * decimal string — the column is bigint("amount", { mode: "bigint" })).
 */
async function seedFact(tenantId: string, amount: number, status = "recorded"): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      factsRepo.ingest(tx, {
        tenantId,
        source: "finance",
        eventType: "payment.released",
        category: "general",
        status,
        amount: BigInt(Math.round(amount)),
        occurredAt: new Date(),
        dedupeKey: randomUUID(),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
}

/** Run a whitelisted aggregate AS a tenant — mirrors queries/consumer.ts exactly. */
function queryAs(tenantId: string, spec: QuerySpec) {
  return runWithTenant(tenantId, () =>
    scopedRead((tx) => runAggregateQuery(tx as unknown as typeof db, tenantId, spec)),
  );
}

beforeAll(async () => {
  await seedFact(TENANT_A, 100);
  await seedFact(TENANT_A, 200);
  await seedFact(TENANT_B, 999);
});

afterAll(async () => {
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      await tx.delete(factEvents).where(eq(factEvents.tenantId, TENANT_A));
      await tx.delete(dashboards).where(eq(dashboards.tenantId, TENANT_A));
    }),
  );
  await runWithTenant(TENANT_B, () =>
    db.transaction(async (tx) => {
      await tx.delete(factEvents).where(eq(factEvents.tenantId, TENANT_B));
    }),
  );
  await sqlClient.end();
});

describe("tenant isolation — a tenant only ever sees its own facts", () => {
  it("sums only tenant A's rows", async () => {
    const spec = querySpecSchema.parse({ metric: "amount_sum", dimensions: [] });
    const res = await queryAs(TENANT_A, spec);
    expect(res.rows[0]?.value).toBe(300);
  });

  it("sums only tenant B's rows (no bleed from A)", async () => {
    const spec = querySpecSchema.parse({ metric: "amount_sum", dimensions: [] });
    const res = await queryAs(TENANT_B, spec);
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
    const a = await queryAs(TENANT_A, spec);
    const b = await queryAs(TENANT_B, spec);
    expect(a.rows[0]?.value).toBe(2);
    expect(b.rows[0]?.value).toBe(1);
    // and the compiled SQL carries the tenant as a bound param
    const { params } = buildAggregateQuery(db, TENANT_A, spec).toSQL();
    expect(params).toContain(TENANT_A);
  });

  it("groups by dimension within the tenant only", async () => {
    const spec = querySpecSchema.parse({ metric: "amount_max", dimensions: ["source"] });
    const res = await queryAs(TENANT_A, spec);
    expect(res.rows).toEqual([{ source: "finance", value: 200 }]);
  });
});

describe("idempotency — redelivered ingestion never double-counts", () => {
  it("re-processing the same messageId is a no-op (inbox markProcessed dedup)", async () => {
    // fact_events is RANGE-partitioned by ingested_at, so a plain (tenant_id,
    // dedupe_key) unique index cannot exist; idempotency is provided by the inbox:
    // ingestEvent() calls markProcessed(messageId) FIRST in the same tx and skips
    // the insert on redelivery. We reproduce that exact path here.
    const tenant = randomUUID();
    const messageId = randomUUID();
    const row = {
      tenantId: tenant,
      source: "grants",
      eventType: "release.processed",
      category: "general",
      status: "recorded",
      amount: 50n,
      occurredAt: new Date(),
      dedupeKey: messageId,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    };

    const ingestOnce = () =>
      runWithTenant(tenant, () =>
        db.transaction(async (tx) => {
          if (!(await markProcessed(tx, messageId))) return; // already processed
          await factsRepo.ingest(tx, row);
        }),
      );

    await ingestOnce();
    await ingestOnce(); // redelivery — markProcessed returns false, insert skipped

    const count = await runWithTenant(tenant, () => factsRepo.countByTenant(tenant));
    expect(count).toBe(1);

    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        await tx.delete(factEvents).where(eq(factEvents.tenantId, tenant));
      }),
    );
  });
});

describe("optimistic locking — stale writes are rejected", () => {
  it("a second update at the same expected version is a no-op (conflict)", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        dashRepo.insert(tx, {
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
        }),
      ),
    );

    const first = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => dashRepo.updateWithVersion(tx, id, TENANT_A, 1, { name: "First" }, ACTOR)),
    );
    expect(first).toBe(true);

    const afterFirst = await runWithTenant(TENANT_A, () => dashRepo.findById(id, TENANT_A));
    expect(afterFirst?.version).toBe(2);
    expect(afterFirst?.name).toBe("First");

    // stale write using the now-outdated version 1
    const conflict = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => dashRepo.updateWithVersion(tx, id, TENANT_A, 1, { name: "Stale" }, ACTOR)),
    );
    expect(conflict).toBe(false);

    const afterConflict = await runWithTenant(TENANT_A, () => dashRepo.findById(id, TENANT_A));
    expect(afterConflict?.name).toBe("First"); // unchanged
    expect(afterConflict?.version).toBe(2);
  });

  it("cross-tenant update never matches (tenant-scoped CAS)", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        dashRepo.insert(tx, {
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
        }),
      ),
    );
    // Attempt the update in tenant B's context: RLS hides A's row AND the CAS
    // predicate scopes by tenant_id, so nothing matches.
    const wrongTenant = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => dashRepo.updateWithVersion(tx, id, TENANT_B, 1, { name: "hijack" }, ACTOR)),
    );
    expect(wrongTenant).toBe(false);
  });
});
