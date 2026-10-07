/**
 * GAP-PROCUREMENT-ORDERS-03: creating and approving a purchase order is a
 * controlled maker-checker action. The audit flagged "+ New PO is visible to
 * every user" and could not verify the server gate ("service absent"). The
 * service IS present and DOES gate POST /pos on PROC_ROLES
 * (procurement_officer / procurement_admin / super_admin) — see
 * modules/po/routes.ts. This pins that: a read-only role (citizen; also
 * finance_officer, which CAN read POs) is rejected 403 FORBIDDEN on create,
 * and an authorised procurement officer is accepted (202). The companion web
 * fix hides "+ New PO" from roles outside PROCUREMENT_WRITE_ROLES.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-6666-4000-8000-000000000099";

function tok(roles: string[]) {
  return signToken({ sub: "user-po-authz", tid: TENANT, roles, sid: "sess-po-authz" }, SECRET);
}

const VALID_PO_BODY = {
  poNo: "PO/IGNORED/001", // server now re-issues; still schema-required.
  vendorId: "22222222-2222-4000-8000-000000000001",
  indentRef: "procurement_indent:33333333-3333-4000-8000-000000000001",
  items: [{ itemCode: "IC-1", description: "Widget", quantity: 1, unitPriceMinor: 1000 }],
};

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/procurement/pos — role gate (GAP-PROCUREMENT-ORDERS-03)", () => {
  it("403 FORBIDDEN for a non-procurement (citizen) role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos",
      headers: { authorization: `Bearer ${tok(["citizen"])}` },
      payload: VALID_PO_BODY,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("403 FORBIDDEN for a read-only finance_officer (can read POs, cannot create)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos",
      headers: { authorization: `Bearer ${tok(["finance_officer"])}` },
      payload: VALID_PO_BODY,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/procurement/pos", payload: VALID_PO_BODY });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("202 Accepted for an authorised procurement_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}` },
      payload: VALID_PO_BODY,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  // GAP-PROCUREMENT-ORDERS-NEW-02: the browser must NOT generate the PO number.
  // A create with NO poNo is accepted — the server issues it from a gapless
  // per-tenant/FY sequence (consumer.ts → allocateDocNo).
  it("202 Accepted when the body omits poNo entirely (server-issued numbering)", async () => {
    const app = await buildApp();
    const { poNo: _ignored, ...noPoNo } = VALID_PO_BODY;
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}` },
      payload: noPoNo,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});
