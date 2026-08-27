/**
 * Regression test (2026-08-27 deep-verify): `POST /v1/visitor/locations`
 * marks `businessHours` optional (`createLocationBody`), but
 * `locations.business_hours` is a NOT NULL jsonb column with no DB-level
 * default. `routes.ts` used to paper over the mismatch with an unsafe
 * `body.businessHours as BusinessHours` cast instead of supplying a
 * value: omitting the field returned a normal 202 Accepted, but the
 * consumer's insert then failed a NOT NULL constraint and the location
 * silently never existed — confirmed live against the freshly-migrated
 * service (POST succeeded, the row was never created, and a
 * visit-request created against that "location" id then failed its own
 * FK constraint).
 *
 * Fix: routes.ts now falls back to `DEFAULT_BUSINESS_HOURS`
 * (validators.ts) when the field is omitted, so the command payload
 * always carries a real value and the consumer's insert succeeds.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createQueue, type MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { scopedRead } from "../src/shared/db.js";
import { registerLocationConsumers } from "../src/modules/location/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { DEFAULT_BUSINESS_HOURS } from "../src/modules/location/validators.js";
import { locations } from "../src/modules/location/schema.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const createdIds: string[] = [];

afterAll(async () => {
  if (createdIds.length === 0) return;
  await runWithTenant(TENANT, () =>
    Promise.all(createdIds.map((id) => scopedRead((tx) => tx.delete(locations).where(eq(locations.id, id))))),
  );
});

describe("location create — businessHours omitted", () => {
  it("persists the location with DEFAULT_BUSINESS_HOURS instead of silently failing", async () => {
    const queue = createQueue() as MemoryQueue;
    registerLocationConsumers(queue);

    const locationId = randomUUID();
    createdIds.push(locationId);
    // Raw message envelope on this test's own local queue (matching this
    // suite's convention, e.g. visit-request-cancel-pass-dangling
    // .integration.test.ts) -- commands.locationCreate() itself publishes
    // to the shared/infra.js global queue singleton, not this local one.
    // Mirrors what routes.ts now does when the caller omits businessHours:
    // the published payload always carries a real BusinessHours value.
    await queue.publish(COMMANDS.locationCreate, {
      type: COMMANDS.locationCreate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: {
        id: locationId,
        tenantId: TENANT,
        name: "Deep-Verify Default-Hours Location",
        businessHours: DEFAULT_BUSINESS_HOURS,
        createdBy: ACTOR,
      },
    });
    await queue.drain();

    const [row] = await runWithTenant(TENANT, () =>
      scopedRead((tx) => tx.select().from(locations).where(eq(locations.id, locationId))),
    );

    expect(row).toBeDefined();
    expect(row?.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
  });
});
