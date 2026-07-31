/**
 * catalogue-locking.int.test.ts — REAL PostgreSQL integration test.
 *
 * The existing catalogue repo test drives Drizzle's query builder against a fake
 * transaction, so `updateProduct`'s optimistic lock had never been proven: the
 * fake decides the return value, not the database. This file connects as the
 * `catalogue_svc` login role (never as the superuser — a superuser bypasses RLS)
 * and drives the ACTUAL repo functions against real rows.
 *
 * Covers: the optimistic-lock contract that makes a 409 reachable (second writer
 * with the same expected version gets `false`), the DB-computed `version + 1`
 * bump, and transactional-outbox atomicity — the business write and its
 * `enqueue()` row commit together or not at all.
 *
 * Skips (does not fail) when Postgres is unreachable so a machine without the
 * dev database still gets a green suite.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq, and, sql } from "drizzle-orm";
import type { ScopedTx } from "../../src/shared/db.js";

const EXPECTED_DB = "civitas_catalogue";
const DEFAULT_DSN = `postgres://catalogue_svc:catalogue_dev_pw@localhost:5435/${EXPECTED_DB}`;
// Only honour an inherited DSN when it actually addresses this service's
// database — a vitest config further up the tree can otherwise point
// DATABASE_URL at a different service's DB.
const inheritedDsn = process.env["DATABASE_URL"];
const DSN = inheritedDsn?.includes(EXPECTED_DB) === true ? inheritedDsn : DEFAULT_DSN;
// `src/shared/db.ts` builds its client at module-evaluation time from
// DATABASE_URL, so the value has to be in place BEFORE that module is imported.
// Hence the dynamic imports below — static imports would be hoisted above this.
process.env["DATABASE_URL"] = DSN;

/** Cheap connectivity probe on a throwaway client, used only to decide skip vs run. */
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

const reachable = await probe();

const { db, sqlClient } = await import("../../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const { enqueue, outboxMessages } = await import("../../src/shared/outbox.js");
const productRepo = await import("../../src/modules/products/repo.js");
const { products } = await import("../../src/modules/products/schema.js");
const { EVENTS } = await import("../../src/topics.js");

/** Unique per run so repeated runs never collide and cleanup is exact. */
const TENANT = randomUUID();
const ACTOR = randomUUID();

/** Every repo call goes through the tenant hook, which sets the app.tenant_id GUC. */
function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, fn));
}

function tx<T>(fn: (t: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** Create a product through the real repo and return its id. */
async function createProduct(name: string): Promise<string> {
  const id = randomUUID();
  await asTenant(TENANT, () =>
    tx((t) =>
      productRepo.insertProduct(t, {
        id,
        tenantId: TENANT,
        name,
        lifecycleStatus: "draft",
        regulatoryMetadata: {},
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: 1,
      }),
    ),
  );
  return id;
}

async function outboxRowsFor(correlationId: string): Promise<Array<{ eventType: string; topic: string }>> {
  return asTenant(TENANT, () =>
    tx((t) =>
      t
        .select({ eventType: outboxMessages.eventType, topic: outboxMessages.topic })
        .from(outboxMessages)
        .where(eq(outboxMessages.correlationId, correlationId)),
    ),
  );
}

describe.skipIf(!reachable)("catalogue repo — real Postgres (optimistic locking, outbox atomicity)", () => {
  afterAll(async () => {
    await asTenant(TENANT, () =>
      tx(async (t) => {
        await t.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
        await t.delete(products).where(eq(products.tenantId, TENANT));
      }),
    ).catch(() => undefined);
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  it("is connected to civitas_catalogue as the non-superuser service role", async () => {
    const rows = await asTenant(TENANT, () =>
      tx((t) =>
        t.execute<{ db: string; who: string; is_super: boolean }>(
          sql`SELECT current_database() AS db, current_user AS who,
                     (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super`,
        ),
      ),
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    expect(row?.db).toBe(EXPECTED_DB);
    expect(row?.who).toBe("catalogue_svc");
    expect(row?.is_super).toBe(false);
  });

  it("lets only the first of two writers with the same expected version through", async () => {
    const id = await createProduct("Locking — sequential");

    const first = await asTenant(TENANT, () =>
      tx((t) => productRepo.updateProduct(t, id, TENANT, { name: "First writer", updatedBy: ACTOR }, 1)),
    );
    const second = await asTenant(TENANT, () =>
      tx((t) => productRepo.updateProduct(t, id, TENANT, { name: "Second writer", updatedBy: ACTOR }, 1)),
    );

    // This pair is exactly what makes the route's 409 VERSION_CONFLICT reachable.
    expect(first).toBe(true);
    expect(second).toBe(false);

    const row = await asTenant(TENANT, () => productRepo.findById(id, TENANT));
    // Version incremented exactly once — the losing writer changed nothing.
    expect(row?.version).toBe(2);
    expect(row?.name).toBe("First writer");
  });

  it("survives two genuinely concurrent updates: exactly one wins", async () => {
    const id = await createProduct("Locking — concurrent");

    // Both transactions are in flight at the same time and both target
    // version 1. Postgres serialises the row lock; the loser re-evaluates the
    // WHERE after the winner commits, matches nothing, and reports false.
    const [a, b] = await Promise.all([
      asTenant(TENANT, () =>
        tx((t) => productRepo.updateProduct(t, id, TENANT, { name: "Writer A", updatedBy: ACTOR }, 1)),
      ),
      asTenant(TENANT, () =>
        tx((t) => productRepo.updateProduct(t, id, TENANT, { name: "Writer B", updatedBy: ACTOR }, 1)),
      ),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);

    const row = await asTenant(TENANT, () => productRepo.findById(id, TENANT));
    expect(row?.version).toBe(2);
    expect(["Writer A", "Writer B"]).toContain(row?.name);
  });

  it("computes the version bump in the database, not the client", async () => {
    const id = await createProduct("Version bump");

    // The patch never mentions `version`; the SET clause uses sql`version + 1`.
    for (let expected = 1; expected <= 3; expected++) {
      const ok = await asTenant(TENANT, () =>
        tx((t) =>
          productRepo.updateProduct(t, id, TENANT, { description: `pass ${expected}`, updatedBy: ACTOR }, expected),
        ),
      );
      expect(ok).toBe(true);
      const row = await asTenant(TENANT, () => productRepo.findById(id, TENANT));
      expect(row?.version).toBe(expected + 1);
    }

    // Proof the increment is server-side: bump the row out from under a stale
    // reader with raw SQL, then a stale expected version no longer matches.
    await asTenant(TENANT, () =>
      tx((t) =>
        t.execute(sql`UPDATE catalogue.products SET version = version + 1 WHERE id = ${id}::uuid`),
      ),
    );
    const bumped = await asTenant(TENANT, () => productRepo.findById(id, TENANT));
    expect(bumped?.version).toBe(5);
    const stale = await asTenant(TENANT, () =>
      tx((t) => productRepo.updateProduct(t, id, TENANT, { description: "stale", updatedBy: ACTOR }, 4)),
    );
    expect(stale).toBe(false);

    // softDelete shares the same lock contract.
    const deleted = await asTenant(TENANT, () =>
      tx((t) => productRepo.softDelete(t, id, TENANT, 5)),
    );
    expect(deleted).toBe(true);
    const withdrawn = await asTenant(TENANT, () => productRepo.findById(id, TENANT));
    expect(withdrawn?.lifecycleStatus).toBe("withdrawn");
    expect(withdrawn?.version).toBe(6);
  });

  it("commits the product row and its outbox row in one transaction", async () => {
    const id = randomUUID();
    const correlationId = randomUUID();

    await asTenant(TENANT, () =>
      tx(async (t) => {
        await productRepo.insertProduct(t, {
          id,
          tenantId: TENANT,
          name: "Atomic create",
          lifecycleStatus: "draft",
          regulatoryMetadata: {},
          createdBy: ACTOR,
          updatedBy: ACTOR,
          version: 1,
        });
        await enqueue(t, {
          topic: EVENTS.productCreated,
          eventType: EVENTS.productCreated,
          tenantId: TENANT,
          actorId: ACTOR,
          correlationId,
          payload: { productId: id, name: "Atomic create" },
        });
      }),
    );

    expect(await asTenant(TENANT, () => productRepo.findById(id, TENANT))).not.toBeNull();
    const events = await outboxRowsFor(correlationId);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe(EVENTS.productCreated);
    // The relay has not run, so the row is still awaiting publication.
    const unpublished = await asTenant(TENANT, () =>
      tx((t) =>
        t
          .select({ id: outboxMessages.id })
          .from(outboxMessages)
          .where(and(eq(outboxMessages.correlationId, correlationId), sql`${outboxMessages.publishedAt} IS NULL`)),
      ),
    );
    expect(unpublished).toHaveLength(1);
  });

  it("rolls back BOTH the product row and its outbox row when the transaction throws", async () => {
    const id = randomUUID();
    const correlationId = randomUUID();

    await expect(
      asTenant(TENANT, () =>
        tx(async (t) => {
          await productRepo.insertProduct(t, {
            id,
            tenantId: TENANT,
            name: "Should not survive",
            lifecycleStatus: "draft",
            regulatoryMetadata: {},
            createdBy: ACTOR,
            updatedBy: ACTOR,
            version: 1,
          });
          await enqueue(t, {
            topic: EVENTS.productCreated,
            eventType: EVENTS.productCreated,
            tenantId: TENANT,
            actorId: ACTOR,
            correlationId,
            payload: { productId: id },
          });
          // Stand-in for the 409 the route raises after a failed optimistic lock.
          throw new Error("VERSION_CONFLICT");
        }),
      ),
    ).rejects.toThrow("VERSION_CONFLICT");

    // No dual-write hole: neither side committed.
    expect(await asTenant(TENANT, () => productRepo.findById(id, TENANT))).toBeNull();
    expect(await outboxRowsFor(correlationId)).toEqual([]);
  });

  it("rolls back the outbox row when the business write is the thing that fails", async () => {
    const id = await createProduct("Conflict source");
    const correlationId = randomUUID();

    await expect(
      asTenant(TENANT, () =>
        tx(async (t) => {
          await enqueue(t, {
            topic: EVENTS.productUpdated,
            eventType: EVENTS.productUpdated,
            tenantId: TENANT,
            actorId: ACTOR,
            correlationId,
            payload: { productId: id },
          });
          const ok = await productRepo.updateProduct(
            t,
            id,
            TENANT,
            { name: "never applied", updatedBy: ACTOR },
            999, // stale version → no row matched
          );
          expect(ok).toBe(false);
          throw new Error("VERSION_CONFLICT");
        }),
      ),
    ).rejects.toThrow("VERSION_CONFLICT");

    expect(await outboxRowsFor(correlationId)).toEqual([]);
    const row = await asTenant(TENANT, () => productRepo.findById(id, TENANT));
    expect(row?.name).toBe("Conflict source");
    expect(row?.version).toBe(1);
  });
});
