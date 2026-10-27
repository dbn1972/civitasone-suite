/**
 * GAP-PROCUREMENT-VENDORS-02 — audited vendor PII reveal.
 *
 * POST /v1/procurement/pii/reveal must: gate by role per field, demand a reason,
 * stay inside the caller's tenant, publish the audit event BEFORE releasing the
 * value (and release nothing when that publish fails), and never put the value
 * in the audit payload.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { AUDIT_TOPIC } from "../src/shared/read-audit.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const VENDOR = randomUUID();
const PHONE = "9876543210";
const PAN = "ABCDE1234F";
const REASON = "Calling the vendor about delivery delay";

function hdr(roles: string[], tenant = TENANT) {
  const token = signToken({ sub: ACTOR, tid: tenant, roles, sid: `sess-${randomUUID()}` }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenant, "content-type": "application/json" };
}
const reveal = (roles: string[], payload: Record<string, unknown>, tenant = TENANT) =>
  app.inject({ method: "POST", url: "/v1/procurement/pii/reveal", headers: hdr(roles, tenant), payload: { resourceType: "vendor", resourceId: VENDOR, field: "phone", reason: REASON, ...payload } });

let app: FastifyInstance;
const audits: Array<Record<string, any>> = [];

beforeAll(async () => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32chars!!"; // gitleaks:allow
  process.env.PII_KEY_ID = "k1";
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementVendors).values({
    id: VENDOR, tenantId: TENANT, name: "Reveal Test Vendor", phone: PHONE, pan: PAN, bankAccount: "123456789012",
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
  await queue.subscribe(AUDIT_TOPIC, async (m) => { audits.push(m.payload as Record<string, any>); });
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GAP-PROCUREMENT-VENDORS-02 audited reveal", () => {
  it("an officer reveals the phone; the audit event names vendor, field and reason but never the value", async () => {
    const res = await reveal(["procurement_officer"], {});
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().data).toMatchObject({ resourceId: VENDOR, field: "phone", value: PHONE });
    await vi.waitFor(() => expect(audits.length).toBeGreaterThan(0));
    const ev = audits.at(-1)!;
    expect(ev).toMatchObject({ action: "vendor_pii_revealed", resourceType: "vendor", resourceId: VENDOR });
    expect(ev.details).toEqual({ field: "phone", reason: REASON });
    expect(JSON.stringify(ev)).not.toContain(PHONE);
  });

  it("PAN is admin/auditor only: an officer gets 403 and no audit event is published", async () => {
    const before = audits.length;
    const denied = await reveal(["procurement_officer"], { field: "pan" });
    expect(denied.statusCode).toBe(403);
    expect(audits.length).toBe(before);
    const ok = await reveal(["audit_officer"], { field: "pan" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.value).toBe(PAN);
  });

  it("a short reason is rejected (400) and nothing is revealed", async () => {
    const res = await reveal(["procurement_officer"], { reason: "short" });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).not.toContain(PHONE);
  });

  it("the bank account is write-only: not revealable even for an admin (422)", async () => {
    const res = await reveal(["procurement_admin"], { field: "bankAccount" });
    expect(res.statusCode).toBe(422);
    const proto = await reveal(["procurement_admin"], { field: "__proto__" });
    expect(proto.statusCode).toBe(422);
  });

  it("is tenant-scoped: another tenant cannot reveal this vendor (404)", async () => {
    const res = await reveal(["procurement_officer"], {}, OTHER_TENANT);
    expect(res.statusCode).toBe(404);
  });

  it("fails closed: when the audit publish fails nothing is revealed (503)", async () => {
    const spy = vi.spyOn(queue, "publish").mockRejectedValueOnce(new Error("queue down: secret detail"));
    const res = await reveal(["procurement_officer"], {});
    spy.mockRestore();
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("AUDIT_UNAVAILABLE");
    expect(JSON.stringify(res.json())).not.toContain(PHONE);
    expect(JSON.stringify(res.json())).not.toContain("secret detail");
  });

  it("an unauthenticated-role caller (citizen) is refused", async () => {
    const res = await reveal(["citizen"], {});
    expect(res.statusCode).toBe(403);
  });
});
