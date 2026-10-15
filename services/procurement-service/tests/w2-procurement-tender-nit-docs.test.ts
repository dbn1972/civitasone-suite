/**
 * Wave 2 procurement part 2:
 *  TENDERS-DETAIL-05          POST /tenders/:id/publish needs a current NIT document.
 *  TENDERS-DETAIL-DOCUMENTS-06 document registration enforces type / size limits.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementTenders } from "../src/modules/tender/schema.js";
import { procurementTenderDocuments } from "../src/modules/tender/docs-schema.js";
import { addDocBody, TENDER_DOC_MAX_BYTES } from "../src/modules/tender/docs-validators.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "c2c2c2c2-4444-4000-8000-000000000001";
const OTHER = "c2c2c2c2-4444-4000-8000-000000000002";
const ACTOR = "c2c2c2c2-5555-4000-8000-000000000001";

let app: FastifyInstance;
const headers = (tid = TENANT, roles = ["procurement_officer"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s-w2t" }, SECRET)}`,
  "content-type": "application/json",
});

async function wipe() {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(procurementTenderDocuments).where(eq(procurementTenderDocuments.tenantId, t));
      await tx.delete(procurementTenders).where(eq(procurementTenders.tenantId, t));
    }));
  }
}
async function seedTender(tenant = TENANT): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(procurementTenders).values({
    id, tenantId: tenant, tenderNo: `T-${id.slice(0, 6)}`, title: "w2 tender", status: "draft", bidClosingDate: "2099-01-01",
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
  return id;
}
async function seedDoc(tenderId: string, docType: string, isCurrent = true) {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementTenderDocuments).values({
    id: randomUUID(), tenderId, tenantId: TENANT, docType, title: `${docType}.pdf`, storageRef: `store/${randomUUID()}`,
    isCurrent, createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("TENDERS-DETAIL-05: publish needs a NIT", () => {
  const publish = (id: string) => app.inject({ method: "POST", url: `/v1/procurement/tenders/${id}/publish`, headers: { authorization: headers().authorization } });

  it("409 NIT_REQUIRED when the tender has no NIT (other document types do not count)", async () => {
    const id = await seedTender();
    await seedDoc(id, "rfp");
    const res = await publish(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NIT_REQUIRED");
  });

  it("a superseded (non-current) NIT does not count", async () => {
    const id = await seedTender();
    await seedDoc(id, "nit", false);
    expect((await publish(id)).statusCode).toBe(409);
  });

  it("202 once a current NIT is attached", async () => {
    const id = await seedTender();
    await seedDoc(id, "nit");
    expect((await publish(id)).statusCode).toBe(202);
  });

  it("404 for an unknown tender and for another tenant's tender", async () => {
    expect((await publish(randomUUID())).statusCode).toBe(404);
    const foreign = await seedTender(OTHER);
    expect((await publish(foreign)).statusCode).toBe(404);
  });
});

describe("TENDERS-DETAIL-DOCUMENTS-06: document type / size limits", () => {
  const base = { docType: "nit", title: "NIT", storageRef: "store/abc" };

  it("accepts a normal PDF within the limit", () => {
    expect(addDocBody.safeParse({ ...base, mimeType: "application/pdf", sizeBytes: 1024 }).success).toBe(true);
    expect(addDocBody.safeParse(base).success).toBe(true); // metadata optional
  });
  it("rejects a disallowed MIME type", () => {
    expect(addDocBody.safeParse({ ...base, mimeType: "application/x-msdownload" }).success).toBe(false);
    expect(addDocBody.safeParse({ ...base, mimeType: "text/html" }).success).toBe(false);
  });
  it("rejects an oversize file", () => {
    expect(addDocBody.safeParse({ ...base, sizeBytes: TENDER_DOC_MAX_BYTES + 1 }).success).toBe(false);
    expect(addDocBody.safeParse({ ...base, sizeBytes: TENDER_DOC_MAX_BYTES }).success).toBe(true);
  });
  it("rejects executable / script file names", () => {
    expect(addDocBody.safeParse({ ...base, storageRef: "store/setup.exe" }).success).toBe(false);
    expect(addDocBody.safeParse({ ...base, title: "run.PS1" }).success).toBe(false);
  });
  // The documents plugin had no error handler, so a role failure surfaced as a
  // bare 500 instead of the 403 the ledger (DOCUMENTS-01) acceptance relies on.
  it("POST /documents answers 403 (not 500) to a role without upload permission", async () => {
    const id = await seedTender();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${id}/documents`, headers: headers(TENANT, ["audit_officer"]),
      payload: { ...base, mimeType: "application/pdf" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("POST /documents answers 400 for a blocked type", async () => {
    const id = await seedTender();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${id}/documents`, headers: headers(),
      payload: { ...base, mimeType: "application/x-msdownload" },
    });
    expect(res.statusCode).toBe(400);
  });
});
