/**
 * Wave 2 procurement part 2b (approvals / indent trail):
 *  APPROVALS-05/07  POST /approvals/ref-summaries - value, requester and the
 *                   parent PO for indent / PO / amendment task refs.
 *  INDENTS-DETAIL-05 getIndent builds approvalTrail from the workflow engine's
 *                   recorded decisions, never a raw user id, and flags an
 *                   unreachable engine instead of faking an empty trail.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos, procurementPoAmendments } from "../src/modules/po/schema.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import * as indentQueries from "../src/modules/indent/queries.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "c2c2c2c2-1111-4000-8000-000000000001";
const OTHER = "c2c2c2c2-1111-4000-8000-000000000002";
const MAKER = "c2c2c2c2-2222-4000-8000-000000000001";
const CHECKER = "c2c2c2c2-2222-4000-8000-000000000002";
const VENDOR_A = "c2c2c2c2-3333-4000-8000-00000000000a";
const VENDOR_B = "c2c2c2c2-3333-4000-8000-00000000000b";

let app: FastifyInstance;
const auth = (tid = TENANT, roles = ["procurement_officer"]) => ({
  authorization: `Bearer ${signToken({ sub: CHECKER, tid, roles, sid: "s-w2a" }, SECRET)}`,
  "content-type": "application/json",
});

const indentId = randomUUID();
const poA = randomUUID();
const poB = randomUUID();
const amendmentId = randomUUID();
const foreignIndent = randomUUID();

async function wipe() {
  for (const t of [TENANT, OTHER]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(procurementPoAmendments).where(eq(procurementPoAmendments.tenantId, t));
      await tx.delete(procurementPos).where(eq(procurementPos.tenantId, t));
      await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, t));
      await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementVendors).values([
      { id: VENDOR_A, tenantId: TENANT, name: "Vendor A", createdBy: MAKER, updatedBy: MAKER },
      { id: VENDOR_B, tenantId: TENANT, name: "Vendor B", createdBy: MAKER, updatedBy: MAKER },
    ]);
    await tx.insert(procurementIndents).values({
      id: indentId, tenantId: TENANT, indentNo: "IND-W2A-1", department: "Stores", purpose: "w2",
      totalMinor: 12345600n, currency: "INR", status: "pending", createdBy: MAKER, updatedBy: MAKER,
    });
    await tx.insert(procurementPos).values([
      { id: poA, tenantId: TENANT, poNo: "PO-W2A-1", vendorId: VENDOR_A, indentRef: "IND-W2A-1", status: "draft", totalMinor: 500000n, createdBy: MAKER, updatedBy: MAKER },
      { id: poB, tenantId: TENANT, poNo: "PO-W2A-2", vendorId: VENDOR_B, indentRef: "IND-W2A-1", status: "draft", totalMinor: 700000n, createdBy: MAKER, updatedBy: MAKER },
    ]);
    await tx.insert(procurementPoAmendments).values({
      id: amendmentId, poId: poA, tenantId: TENANT, amendmentNo: 2, reason: "scope", deltaMinor: -25000n,
      prevTotalMinor: 500000n, newTotalMinor: 475000n, requestedBy: MAKER, createdBy: MAKER, updatedBy: MAKER,
    });
  }));
  await runWithTenant(OTHER, () => db.transaction(async (tx) => {
    await tx.insert(procurementIndents).values({
      id: foreignIndent, tenantId: OTHER, indentNo: "IND-OTHER", department: "X", purpose: "x",
      totalMinor: 999n, currency: "INR", status: "pending", createdBy: MAKER, updatedBy: MAKER,
    });
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("APPROVALS-05/07: ref-summaries", () => {
  const post = (refs: unknown, headers = auth()) =>
    app.inject({ method: "POST", url: "/v1/procurement/approvals/ref-summaries", headers, payload: { refs } });

  it("returns value + label for an indent and a PO, and the parent PO for an amendment", async () => {
    const res = await post([
      { refType: "procurement_indent", refId: indentId },
      { refType: "procurement_po", refId: poA },
      { refType: "procurement_po_amendment", refId: amendmentId },
    ]);
    expect(res.statusCode).toBe(200);
    const by = Object.fromEntries(res.json().data.map((r: { refId: string }) => [r.refId, r]));
    expect(by[indentId]).toMatchObject({ label: "IND-W2A-1", amountMinor: "12345600" });
    expect(by[poA]).toMatchObject({ label: "PO-W2A-1", amountMinor: "500000" });
    // The amendment's value is the signed CHANGE, and it carries the PO to link to.
    expect(by[amendmentId]).toMatchObject({ label: "PO-W2A-1 / Amendment 2", amountMinor: "-25000", poId: poA });
  });

  it("never resolves another tenant's record", async () => {
    const res = await post([{ refType: "procurement_indent", refId: foreignIndent }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("validates input and enforces the role gate", async () => {
    expect((await post([])).statusCode).toBe(400);
    expect((await post([{ refType: "leave_app", refId: indentId }])).statusCode).toBe(400);
    expect((await post([{ refType: "procurement_po", refId: "nope" }])).statusCode).toBe(400);
    expect((await post([{ refType: "procurement_po", refId: poA }], auth(TENANT, ["citizen"]))).statusCode).toBe(403);
  });
});

describe("INDENTS-DETAIL-05: approvalTrail from workflow decisions", () => {
  function stubFetch(handlers: { decisions?: () => Response; users?: () => Response }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/v1/workflow/internal/ref-decisions")) return handlers.decisions?.() ?? new Response("{}", { status: 503 });
      if (url.includes("/identity/internal/user-summaries")) return handlers.users?.() ?? new Response("[]");
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it("maps recorded decisions to actor name / action / time / reason (no raw ids)", async () => {
    const spy = stubFetch({
      decisions: () => new Response(JSON.stringify({ data: [
        { action: "return", decision: "return", actorId: CHECKER, nodeKey: "review", reason: "Add quotation", at: "2026-10-01T05:00:00.000Z" },
        { action: "reject", decision: "reject", actorId: randomUUID(), nodeKey: "review", reason: "Over budget", at: "2026-10-02T05:00:00.000Z" },
      ] })),
      users: () => new Response(JSON.stringify([{ id: CHECKER, name: "Asha Verma" }])),
    });
    const detail = await runWithTenant(TENANT, () => indentQueries.getIndent(indentId, TENANT)) as { approvalTrail: Array<Record<string, string>>; approvalTrailAvailable: boolean };
    expect(detail.approvalTrailAvailable).toBe(true);
    expect(detail.approvalTrail).toEqual([
      { actor: "Asha Verma", action: "Returned", timestamp: "2026-10-01T05:00:00.000Z", remarks: "Add quotation" },
      { actor: "Unknown user", action: "Rejected", timestamp: "2026-10-02T05:00:00.000Z", remarks: "Over budget" },
    ]);
    // Asked the engine for THIS indent, tenant-scoped, with the internal headers.
    const call = spy.mock.calls.find((c) => String(c[0]).includes("ref-decisions"))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ refType: "procurement_indent", refId: indentId });
    expect((call[1] as RequestInit).headers).toMatchObject({ "x-internal": "1", "x-tenant-id": TENANT });
  });

  it("an undecided indent has an empty but AVAILABLE trail", async () => {
    stubFetch({ decisions: () => new Response(JSON.stringify({ data: [] })) });
    const detail = await runWithTenant(TENANT, () => indentQueries.getIndent(indentId, TENANT)) as { approvalTrail: unknown[]; approvalTrailAvailable: boolean };
    expect(detail.approvalTrail).toEqual([]);
    expect(detail.approvalTrailAvailable).toBe(true);
  });

  it("an unreachable engine is flagged unavailable, not rendered as 'no decisions'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const detail = await runWithTenant(TENANT, () => indentQueries.getIndent(indentId, TENANT)) as { approvalTrail: unknown[]; approvalTrailAvailable: boolean };
    expect(detail.approvalTrail).toEqual([]);
    expect(detail.approvalTrailAvailable).toBe(false);
  });
});
