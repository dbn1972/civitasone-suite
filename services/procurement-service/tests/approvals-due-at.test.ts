/**
 * GAP-PROCUREMENT-APPROVALS-04 (backend): the /v1/procurement/approvals list
 * must emit an ISO `dueAt` alongside the localised `dueDisplay` so the web can
 * compute overdue/due-today by date rather than substring-matching copy.
 * Pending indents expose required_by; draft POs expose delivery_date.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import { procurementPos } from "../src/modules/po/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9a900000-1111-4000-8000-00000000d0e4";
const ACTOR  = "9a900000-2222-4000-8000-00000000d0e2";

function token(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_admin", "super_admin"], sid: "sess-due" }, SECRET, 3600);
}

let app: FastifyInstance;
let auth: string;
let indentId: string;
let poId: string;

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementPos).where(eq(procurementPos.tenantId, TENANT));
    await tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, TENANT));
  }));
}

async function seed(): Promise<void> {
  indentId = randomUUID();
  poId = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementIndents).values({
      id: indentId, tenantId: TENANT, indentNo: "IND-DUE-1", department: "Stores",
      purpose: "Test", status: "pending", requiredBy: "2026-02-15",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(procurementPos).values({
      id: poId, tenantId: TENANT, poNo: "PO-DUE-1", vendorId: randomUUID(), indentRef: "IND-DUE-1",
      status: "draft", deliveryDate: "2026-03-20", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

beforeAll(async () => {
  app = await buildApp();
  auth = token();
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/procurement/approvals — dueAt (GAP-PROCUREMENT-APPROVALS-04)", () => {
  it("emits an ISO dueAt for a pending indent (from required_by) and a draft PO (from delivery_date)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/procurement/approvals", headers: { authorization: `Bearer ${auth}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);

    const indentRow = body.data.find((r: { referenceId?: string }) => r.referenceId === "IND-DUE-1");
    expect(indentRow).toBeDefined();
    expect(typeof indentRow.dueAt).toBe("string");
    // Parseable ISO date resolving to the seeded required_by.
    expect(new Date(indentRow.dueAt).toISOString().slice(0, 10)).toBe("2026-02-15");
    // The display string is still present for rendering.
    expect(typeof indentRow.dueDisplay).toBe("string");

    const poRow = body.data.find((r: { referenceId?: string }) => r.referenceId === "PO-DUE-1");
    expect(poRow).toBeDefined();
    expect(typeof poRow.dueAt).toBe("string");
    expect(new Date(poRow.dueAt).toISOString().slice(0, 10)).toBe("2026-03-20");
  });
});
