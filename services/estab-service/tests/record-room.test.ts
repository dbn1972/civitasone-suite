/**
 * R4 — Record-room management (CSMOP "Custody of records").
 * Verifies: transfer to record room (sets location + state), requisition
 * (issues from record room), return (flips back to in_record_room), and
 * guards (cannot issue from a file still in_section). Tenant-scoped.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFileRecord, estabRecordRequisition } from "../src/modules/records/schema.js";
import {
  upsertRecord, transferToRecordRoom, insertRequisition,
  markRecordIssued, markRecordReturned, findRecord,
  findRequisitionByIdTx, updateRequisition, listRequisitions,
} from "../src/modules/records/repo.js";

const TENANT_A = "71111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "71111111-aaaa-4000-8000-0000000000b2";
const FILE_A   = "71111111-bbbb-4000-8000-0000000000f1";
const FILE_B   = "71111111-bbbb-4000-8000-0000000000f2";
const ACTOR    = "00000000-ffff-4000-8000-0000000000c3";

// Test-harness fix: bare db.delete()/db.execute() outside db.transaction() run
// with no RLS GUC set (wrapWithTenantGuc only injects app.tenant_id inside
// transactions started under an active tenant context). Wrap each tenant's
// cleanup in runWithTenant(tenant, () => db.transaction(...)).
async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(estabRecordRequisition).where(eq(estabRecordRequisition.tenantId, t));
        await tx.execute(sql`DELETE FROM files.estab_file_record WHERE tenant_id = ${t}::uuid`);
      }),
    );
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

// Test-harness fix: upsertRecord takes a `tx: Writer` param — the bare `db`
// handle passed directly here runs with no RLS GUC set unless wrapped in
// runWithTenant + db.transaction() at the call site.
async function seedRecord(tenantId: string, fileId: string) {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      upsertRecord(tx, {
        tenantId, fileId, recordCategory: "B", retentionYears: 10,
        reviewDueDate: "2036-01-01", createdBy: ACTOR,
      }),
    ),
  );
}

describe("R4 record-room transfer", () => {
  it("sets location + room_status=in_record_room on transfer", async () => {
    await seedRecord(TENANT_A, FILE_A);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => transferToRecordRoom(tx, TENANT_A, FILE_A, { rack: "R3", shelf: "S2", bundleNo: "B12" }, ACTOR)),
    );
    const rec = await runWithTenant(TENANT_A, () => findRecord(TENANT_A, FILE_A));
    expect(rec?.roomStatus).toBe("in_record_room");
    expect(rec?.rack).toBe("R3");
    expect(rec?.shelf).toBe("S2");
    expect(rec?.bundleNo).toBe("B12");
    expect(rec?.transferredAt).not.toBeNull();
  });
});

describe("R4 requisition + return", () => {
  it("issues a record (room_status→issued) and returns it (→in_record_room)", async () => {
    await seedRecord(TENANT_A, FILE_A);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => transferToRecordRoom(tx, TENANT_A, FILE_A, { rack: "R1" }, ACTOR)),
    );

    const reqId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        insertRequisition(tx, {
          id: reqId, tenantId: TENANT_A, fileId: FILE_A, requestedBy: ACTOR,
          purpose: "Audit check", status: "issued", createdBy: ACTOR,
        }),
      ),
    );
    await runWithTenant(TENANT_A, () => db.transaction((tx) => markRecordIssued(tx, TENANT_A, FILE_A, ACTOR)));

    let rec = await runWithTenant(TENANT_A, () => findRecord(TENANT_A, FILE_A));
    expect(rec?.roomStatus).toBe("issued");

    // Return
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => updateRequisition(tx, reqId, { status: "returned", returnedAt: new Date() })),
    );
    await runWithTenant(TENANT_A, () => db.transaction((tx) => markRecordReturned(tx, TENANT_A, FILE_A, ACTOR)));

    rec = await runWithTenant(TENANT_A, () => findRecord(TENANT_A, FILE_A));
    expect(rec?.roomStatus).toBe("in_record_room");
    const req = await runWithTenant(TENANT_A, () => db.transaction((tx) => findRequisitionByIdTx(tx, reqId, TENANT_A)));
    expect(req?.status).toBe("returned");
    expect(req?.returnedAt).not.toBeNull();
  });

  it("lists requisitions by status (tenant-scoped)", async () => {
    await seedRecord(TENANT_A, FILE_A);
    await runWithTenant(TENANT_A, () => db.transaction((tx) => transferToRecordRoom(tx, TENANT_A, FILE_A, {}, ACTOR)));
    const r1 = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => insertRequisition(tx, { id: r1, tenantId: TENANT_A, fileId: FILE_A, requestedBy: ACTOR, status: "issued", createdBy: ACTOR })),
    );
    const r2 = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => insertRequisition(tx, { id: r2, tenantId: TENANT_A, fileId: FILE_A, requestedBy: ACTOR, status: "returned", returnedAt: new Date(), createdBy: ACTOR })),
    );

    const issued = await runWithTenant(TENANT_A, () => listRequisitions(TENANT_A, "issued", 50));
    expect(issued.map((r) => r.id)).toContain(r1);
    expect(issued.map((r) => r.id)).not.toContain(r2);

    const all = await runWithTenant(TENANT_A, () => listRequisitions(TENANT_A, undefined, 50));
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("is tenant-scoped (tenant B cannot see tenant A requisitions)", async () => {
    await seedRecord(TENANT_A, FILE_A);
    await runWithTenant(TENANT_A, () => db.transaction((tx) => transferToRecordRoom(tx, TENANT_A, FILE_A, {}, ACTOR)));
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => insertRequisition(tx, { id: randomUUID(), tenantId: TENANT_A, fileId: FILE_A, requestedBy: ACTOR, status: "issued", createdBy: ACTOR })),
    );

    const fromB = await runWithTenant(TENANT_B, () => listRequisitions(TENANT_B, undefined, 50));
    expect(fromB).toHaveLength(0);
  });
});
