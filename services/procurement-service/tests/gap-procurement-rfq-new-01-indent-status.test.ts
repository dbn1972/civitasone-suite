/** GAP-PROCUREMENT-RFQ-NEW-01: POST /rfqs rejects an indent that is not approved (server is the real control). */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "9b900000-1111-4000-8000-0000000000b1";
const OTHER_TENANT = "9b900000-1111-4000-8000-0000000000b2";
const ACTOR = "9b900000-2222-4000-8000-0000000000b1";
const VENDOR = "9b900000-3333-4000-8000-0000000000b1";
const tok = () => signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer"], sid: "s-rfq-b1" }, SECRET, 3600);

const ids = { draft: randomUUID(), approved: randomUUID(), foreign: randomUUID() };
let app: FastifyInstance;

async function seed(id: string, tenantId: string, status: string) {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(procurementIndents).values({
      id, tenantId, indentNo: `IND-B1-${id.slice(0, 4)}`, department: "IT", purpose: "t", status, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}
async function post(indentRef: string | undefined) {
  return app.inject({
    method: "POST", url: "/v1/procurement/rfqs",
    headers: { authorization: `Bearer ${tok()}`, "content-type": "application/json" },
    payload: { title: "Supply", closingDate: "2026-12-01", vendorIds: [VENDOR], indentRef,
      // One real vendor: the GFR minimum of three needs a justification (RFQ-NEW-02) so these tests exercise the indent rules.
      fewerVendorsJustification: "Sole source for this test" },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values({
    id: VENDOR, tenantId: TENANT, name: "RFQ indent-test vendor", createdBy: ACTOR, updatedBy: ACTOR,
  })));
  await seed(ids.draft, TENANT, "draft");
  await seed(ids.approved, TENANT, "approved");
  await seed(ids.foreign, OTHER_TENANT, "approved");
});
afterAll(async () => {
  for (const [t, id] of [[TENANT, ids.draft], [TENANT, ids.approved], [OTHER_TENANT, ids.foreign]] as const) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(procurementIndents).where(eq(procurementIndents.id, id))));
  }
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(procurementVendors).where(eq(procurementVendors.id, VENDOR))));
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/procurement/rfqs — indent must be approved", () => {
  it("rejects a draft indent with 422 INDENT_NOT_APPROVED", async () => {
    const r = await post(`procurement_indent:${ids.draft}`);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INDENT_NOT_APPROVED");
  });
  it("rejects an unknown indent and another tenant's indent with 422 INDENT_NOT_FOUND", async () => {
    expect((await post(`procurement_indent:${randomUUID()}`)).json().code).toBe("INDENT_NOT_FOUND");
    expect((await post(`procurement_indent:${ids.foreign}`)).json().code).toBe("INDENT_NOT_FOUND");
  });
  it("rejects a malformed non-empty indentRef with 422 INDENT_REF_INVALID (no bypass of the approved-indent check)", async () => {
    for (const bad of ["procurement_indent:abc", "free text ref", `indent:${ids.approved}`, ids.approved, `procurement_indent:${ids.approved} `.replace(/ $/, "x")]) {
      const r = await post(bad);
      expect(r.statusCode, bad).toBe(422);
      expect(r.json().code, bad).toBe("INDENT_REF_INVALID");
    }
  });
  it("still accepts an RFQ with no indentRef (legacy no-indent RFQ)", async () => {
    expect((await post(undefined)).statusCode).toBe(202);
  });
  it("accepts an approved indent", async () => {
    expect((await post(`procurement_indent:${ids.approved}`)).statusCode).toBe(202);
  });
});
