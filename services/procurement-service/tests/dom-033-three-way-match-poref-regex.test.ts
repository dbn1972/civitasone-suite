/**
 * DOM-033 -- the direct POST /v1/procurement/three-way-match endpoint's
 * PO/GRN-match precondition used an escaped-caret regex
 * (/\^procurement_po:/) to strip the "procurement_po:" prefix off
 * grn.poRef before comparing it to body.poId. A backslash-escaped caret
 * inside a regex matches a LITERAL caret character, not the start-of-string
 * anchor, unlike the correctly-anchored /^procurement_po:/ used
 * consistently everywhere else this same poRef format is parsed
 * (grn/consumer.ts, grn/repo.ts, three-way-match/consumer.ts). Since a real
 * poRef never contains a literal caret, the .replace() was always a no-op:
 * grnPoId kept its "procurement_po:" prefix forever and could never equal
 * the bare body.poId, so the endpoint threw 409 GRN_PO_MISMATCH
 * unconditionally for every genuinely-matching PO+GRN pair.
 *
 * No existing test caught this because every HTTP-layer test for this route
 * (routes-coverage-full.test.ts, dom-027's own validation-layer tests) uses
 * a nonexistent PO that 404s before ever reaching the broken line. This
 * file seeds a REAL, matching PO+GRN pair (mirroring
 * dom-027-three-way-match-invoice-ref.test.ts's seedPoAndGrn fixture
 * exactly) and drives it through the real HTTP route, which is the only
 * way to actually exercise the buggy line.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { threeWayMatch } from "../src/modules/three-way-match/schema.js";
import { procurementPos, procurementPoItems } from "../src/modules/po/schema.js";
import { procurementGrns, procurementGrnItems } from "../src/modules/grn/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "d0033033-aaaa-4000-8000-000000000001";
const ACTOR = randomUUID();

function tok(roles: string[] = ["procurement_officer", "procurement_admin", "super_admin"]) {
  return signToken({ sub: "user-dom033", tid: TENANT, roles, sid: "sess-dom033" }, SECRET);
}
const auth = { authorization: `Bearer ${tok()}` };

/** Seeds a real PO (single item) + GRN (single item) pair, mirroring
 *  tests/dom-027-three-way-match-invoice-ref.test.ts's seedPoAndGrn fixture
 *  shape exactly -- including the real procurement_po:<poId> poRef prefix,
 *  which is the exact value the buggy regex failed to strip. */
async function seedPoAndGrn(tenantId: string, label: string) {
  const poId = randomUUID();
  const poItemId = randomUUID();
  const grnId = randomUUID();
  const unitPriceMinor = 2_000n;
  const qty = 10;

  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPos).values({
    id: poId, tenantId, poNo: `PO-DOM033-${label}-${poId.slice(0, 8)}`, vendorId: randomUUID(),
    indentRef: "IND-DOM033", totalMinor: unitPriceMinor * BigInt(qty), status: "approved",
    createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementPoItems).values({
    id: poItemId, poId, tenantId, itemCode: "ITEM-DOM033", description: "test item",
    quantity: qty, unitPriceMinor, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrns).values({
    id: grnId, tenantId, grnNo: `GRN-DOM033-${label}-${grnId.slice(0, 8)}`, poRef: `procurement_po:${poId}`,
    vendorId: randomUUID(), status: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  await withTenantScope(db, tenantId, (tx: any) => tx.insert(procurementGrnItems).values({
    id: randomUUID(), grnId, tenantId, poItemRef: poItemId, itemCode: "ITEM-DOM033",
    orderedQty: qty, receivedQty: qty, acceptedQty: qty, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return { poId, grnId };
}

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(threeWayMatch).where(eq(threeWayMatch.tenantId, TENANT));
    await tx.delete(procurementGrnItems).where(eq(procurementGrnItems.tenantId, TENANT));
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
    await tx.delete(procurementPoItems).where(eq(procurementPoItems.tenantId, TENANT));
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
  }));
}

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("DOM-033 -- POST /v1/procurement/three-way-match poRef-anchor regression", () => {
  it("succeeds (202, not 409) for a genuinely-matching, freshly seeded real PO+GRN pair -- the exact DoD for this fix", async () => {
    await cleanup();
    const { poId, grnId } = await seedPoAndGrn(TENANT, "match");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId, grnId },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json() as { id: string; status: string; correlationId: string };
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
  });

  it("still 409s (GRN_PO_MISMATCH) for a genuine PO/GRN mismatch -- proves the fix restores the check rather than disabling it", async () => {
    await cleanup();
    const { poId: poIdA } = await seedPoAndGrn(TENANT, "mismatch-a");
    const { grnId: grnIdB } = await seedPoAndGrn(TENANT, "mismatch-b");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: poIdA, grnId: grnIdB },
    });
    await app.close();

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "GRN_PO_MISMATCH" });
  });
});
