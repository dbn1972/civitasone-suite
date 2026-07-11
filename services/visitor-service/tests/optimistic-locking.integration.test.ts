/**
 * Fix 3 (P1 correctness): optimistic locking must be a real compare-and-swap.
 *
 * Before the fix, consumer UPDATEs set `version: request.version + 1` but the
 * WHERE only matched (id, tenantId) — so two concurrent transitions both
 * committed (lost update + duplicate downstream event). This test drives two
 * racing transitions through the real `versionedUpdate` helper against the live
 * DB and proves exactly one commits and the other conflicts (so the loser's
 * whole transaction — including any event it would enqueue — rolls back).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../src/shared/db.js";
import { versionedUpdate, VersionConflictError } from "../src/shared/outbox.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations } from "../src/modules/location/schema.js";

const TENANT = randomUUID();
const LOCATION = randomUUID();
const HOST = randomUUID();
const ACTOR = randomUUID();
const REQ_ID = randomUUID();

const BUSINESS_HOURS = {
  mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
};

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(locations).values({
        id: LOCATION,
        tenantId: TENANT,
        name: "Test Location",
        businessHours: BUSINESS_HOURS,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
      await tx.insert(visitRequests).values({
        id: REQ_ID,
        tenantId: TENANT,
        locationId: LOCATION,
        hostEmployeeId: HOST,
        visitorName: "Race Subject",
        visitorPhone: "+911234567890",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    }),
  );
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(visitRequests).where(eq(visitRequests.id, REQ_ID));
      await tx.delete(locations).where(eq(locations.id, LOCATION));
    }),
  );
});

describe("optimistic locking (versionedUpdate) — concurrent visit-request transitions", () => {
  it("commits exactly one of two racing transitions; the other conflicts", async () => {
    const transition = (status: string) =>
      runWithTenant(TENANT, () =>
        db.transaction((tx) =>
          versionedUpdate(tx, visitRequests, {
            id: REQ_ID,
            tenantId: TENANT,
            expectedVersion: 1,
            set: { status, updatedAt: new Date(), updatedBy: ACTOR },
            entity: "visit_request",
          }),
        ),
      );

    const results = await Promise.allSettled([
      transition("approved"),
      transition("rejected"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser must surface a VersionConflictError (not a silent success).
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(
      reason instanceof VersionConflictError || reason?.code === "VERSION_CONFLICT",
    ).toBe(true);

    // The row advanced by exactly one version (not two — no lost update).
    const rows = await runWithTenant(TENANT, () =>
      scopedRead((tx) =>
        tx
          .select({ version: visitRequests.version, status: visitRequests.status })
          .from(visitRequests)
          .where(eq(visitRequests.id, REQ_ID)),
      ),
    );
    expect(rows[0]?.version).toBe(2);
  });
});
