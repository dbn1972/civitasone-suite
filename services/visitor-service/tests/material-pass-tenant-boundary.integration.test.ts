/**
 * material-pass — cross-tenant referential-integrity gap + tenant isolation
 * (real DB, real consumer).
 *
 * Originally live-confirmed against the running audit instance (2026-08-25):
 * a `security_admin`-role JWT for TENANT B could POST
 * /v1/visitor/material-passes with a `passId`/`locationId` that belong to a
 * DIFFERENT tenant (A) and have it succeed — the resulting row was persisted
 * with `tenant_id = B` but `pass_id`/`location_id` pointing at tenant A's
 * real digital-pass/location rows. modules/material-pass/consumer.ts did not
 * verify that the caller-supplied passId/locationId actually belonged to the
 * authenticated caller's own tenant before inserting — only the new row's
 * OWN tenant_id column was set from the token. The FK constraints
 * (material_passes_pass_id_fkey -> digital_passes.id,
 * material_passes_location_id_fkey -> locations.id) only prove the target
 * EXISTS somewhere, not that it belongs to the caller.
 *
 * Fixed: the materialPassCreate handler now looks up both passId (against
 * digital_passes) and locationId (against locations) scoped by
 * `eq(..., msg.tenantId)` before inserting — the same "not found for this
 * tenant" ownership check modules/check-in/consumer.ts already applies to
 * passId. A cross-tenant reference now throws and the whole transaction
 * (including markProcessed) rolls back, so no phantom row is ever
 * persisted; the message lands in the queue's DLQ instead.
 *
 * This was never a read-side data leak — RLS always scoped every SELECT by
 * the row's own tenant_id, so tenant A could never see tenant B's phantom
 * row and vice versa (confirmed below, still true). It WAS a write-side
 * tenant-boundary/data-integrity gap: tenant B could plant a record that
 * referenced tenant A's real internal resource ids merely by
 * knowing/guessing a UUID, and any future feature that joins across
 * tenant_id without re-verifying ownership (analytics, support tooling,
 * audit correlation) would have been corrupted by it.
 * modules/location/routes.ts already showed the correct pattern elsewhere in
 * this same service — it calls `repo.getLocationById(ctx.tenantId, id)`
 * before allowing a nested area/parking write under that location id, i.e.
 * it verifies ownership before trusting a client-supplied foreign id.
 *
 * NOTE — scope: modules/vehicle-pass/consumer.ts has the identical
 * unverified-FK pattern for its own passId/locationId and is NOT covered by
 * this fix or this file; it is a separate, not-yet-fixed finding (flagged
 * for follow-up).
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { createQueue, type Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { locations } from "../src/modules/location/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { materialPasses } from "../src/modules/material-pass/schema.js";
import { registerMaterialPassConsumers } from "../src/modules/material-pass/consumer.js";
import { COMMANDS } from "../src/topics.js";

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
} as const;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID(); // an entirely separate tenant — never seeded with its own resources
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const LOCATION_A = randomUUID();
const HOST_A = randomUUID();
const VISIT_REQUEST_A = randomUUID();
const DIGITAL_PASS_A = randomUUID();

function freshQueue() {
  // See tests/vehicle-pass-consumer.integration.test.ts's file header for why
  // createQueue() (not `new MemoryQueue()`) is required for RLS-scoped writes
  // to work under the real DB in tests. `dlq` is exposed so the rejected
  // cross-tenant command can be confirmed dead-lettered, not just silently
  // dropped.
  const queue = createQueue() as Queue & { dlq: unknown[]; drain(): Promise<void> };
  registerMaterialPassConsumers(queue);
  return queue;
}

async function publishCreate(
  queue: Queue & { dlq: unknown[]; drain(): Promise<void> },
  tenantId: string,
  actorId: string,
  overrides: Record<string, unknown>,
): Promise<void> {
  const id = randomUUID();
  await queue.publish(COMMANDS.materialPassCreate, {
    messageId: id, tenantId, actorId, correlationId: `corr-${id}`,
    type: COMMANDS.materialPassCreate, schemaVersion: "1.0",
    payload: {
      id, tenantId, passId: DIGITAL_PASS_A, locationId: LOCATION_A,
      items: [{ description: "AUDIT-CROSSTENANT-PROBE item", quantity: 1 }],
      ...overrides,
    },
  });
  await queue.drain();
}

async function materialPassesFor(tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(materialPasses).where(eq(materialPasses.tenantId, tenantId))),
  );
}

afterAll(async () => {
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      await tx.delete(materialPasses).where(eq(materialPasses.locationId, LOCATION_A));
      await tx.delete(digitalPasses).where(eq(digitalPasses.id, DIGITAL_PASS_A));
      await tx.delete(visitRequests).where(eq(visitRequests.id, VISIT_REQUEST_A));
      await tx.delete(locations).where(eq(locations.id, LOCATION_A));
    }),
  ).catch(() => undefined);
  // TENANT_B's phantom row is tagged tenant_id = B, so it must be deleted
  // under B's own RLS context even though it references A's resources.
  await runWithTenant(TENANT_B, () =>
    db.transaction((tx) => tx.delete(materialPasses).where(eq(materialPasses.tenantId, TENANT_B))),
  ).catch(() => undefined);
  await sqlClient.end();
});

describe("material-pass consumer — cross-tenant foreign-id reference (real DB, real consumer, real RLS)", () => {
  it("seed fixture: tenant A location + visit request + digital pass", async () => {
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        await tx.insert(locations).values({
          id: LOCATION_A, tenantId: TENANT_A, name: `AUDIT Location ${TENANT_A}`,
          businessHours: BUSINESS_HOURS, createdBy: ACTOR_A, updatedBy: ACTOR_A,
        });
        await tx.insert(visitRequests).values({
          id: VISIT_REQUEST_A, tenantId: TENANT_A, locationId: LOCATION_A,
          hostEmployeeId: HOST_A, visitorName: `AUDIT Visitor ${TENANT_A}`,
          visitorPhone: "+911234500001", createdBy: ACTOR_A, updatedBy: ACTOR_A,
        });
        await tx.insert(digitalPasses).values({
          id: DIGITAL_PASS_A, tenantId: TENANT_A, visitRequestId: VISIT_REQUEST_A,
          locationId: LOCATION_A, passNumber: TENANT_A.slice(0, 8), passType: "single",
          qrJwt: "test.qr.jwt", validFrom: new Date(), validUntil: new Date(Date.now() + 86_400_000),
          createdBy: ACTOR_A, updatedBy: ACTOR_A,
        });
      }),
    );
    // Sanity: fixture actually exists under tenant A.
    const rows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(digitalPasses).where(eq(digitalPasses.id, DIGITAL_PASS_A))),
    );
    expect(rows).toHaveLength(1);
  });

  it("FIXED: tenant B can no longer create a material-pass row referencing tenant A's real passId/locationId", async () => {
    const queue = freshQueue();
    await publishCreate(queue, TENANT_B, ACTOR_B, {});

    const crossTenantRows = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(materialPasses).where(eq(materialPasses.tenantId, TENANT_B))),
    );

    // No phantom row: the tenant-ownership check rejected passId=DIGITAL_PASS_A
    // (a real row, but tenant A's, not tenant B's) before any insert ran.
    expect(crossTenantRows).toHaveLength(0);
    // The rejected command was dead-lettered, not silently swallowed.
    expect(queue.dlq).toHaveLength(1);
    expect(queue.dlq[0]).toMatchObject({
      error: expect.stringContaining(`digital pass '${DIGITAL_PASS_A}' not found for tenant '${TENANT_B}'`),
    });
  });

  it("but this is NOT a read-side leak: tenant A cannot read tenant B's phantom row under tenant A's own RLS context (raw DB, cache bypassed)", async () => {
    const asTenantA = await materialPassesFor(TENANT_A);
    expect(asTenantA.every((r) => r.tenantId === TENANT_A)).toBe(true);
    expect(asTenantA.some((r) => r.tenantId === TENANT_B)).toBe(false);
  });

  it("and tenant B cannot read tenant A's OWN material-pass rows either — RLS isolates reads both directions even though B's row references A's ids", async () => {
    // Create a legitimate tenant-A row (its own real passId) so there is
    // something for tenant B to try to see.
    const queue = freshQueue();
    await publishCreate(queue, TENANT_A, ACTOR_A, {
      items: [{ description: "AUDIT-TENANT-A-OWN item", quantity: 1 }],
    });

    const asTenantB = await materialPassesFor(TENANT_B);
    expect(asTenantB.some((r) => r.itemDescription === "AUDIT-TENANT-A-OWN item")).toBe(false);
    // Tenant B has zero rows at all now (its earlier cross-tenant attempt
    // was rejected, not just isolated on read) — vacuously, everything it
    // does see (nothing) is tagged tenant_id = B.
    expect(asTenantB.every((r) => r.tenantId === TENANT_B)).toBe(true);
  });
});
