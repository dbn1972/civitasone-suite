/**
 * Tenant profile switch (owner decision 3): PUT /v1/finance/settings for an accounting-basis switch.
 *  - flag OFF (default): behaves exactly as before; no effective date is attached to the change request.
 *  - flag ON: a mid-year date is a 422 and nothing is published; no date resolves to the next 1 April.
 * A basis switch is always held for a second admin, so the change travels as a change request whose
 * own body is under payload.payload.
 */
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN = randomUUID();
const headers = { authorization: `Bearer ${signToken({ sub: ADMIN, tid: TENANT, roles: ["finance_admin"], sid: "s-tp" }, SECRET)}` };
const REASON = "Move to accrual books for the new financial year";

const prev = process.env.TENANT_PROFILES_ENABLED;
afterEach(() => {
  vi.restoreAllMocks();
  if (prev === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prev;
});
afterAll(async () => { await sqlClient.end(); });

type Sent = { topic: string; env: { payload: { payload: Record<string, unknown> } } };

async function put(payload: Record<string, unknown>) {
  const sent: Sent[] = [];
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, env: any) => { sent.push({ topic, env }); return undefined as never; });
  const app = await buildApp();
  try {
    const res = await app.inject({ method: "PUT", url: "/v1/finance/settings", headers, payload });
    return { res, sent };
  } finally { await app.close(); }
}

describe("PUT /v1/finance/settings accounting-basis switch", () => {
  it("flag off: held for a second admin as before; a supplied date is ignored and none is attached", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    const { res, sent } = await put({ accountingBasis: "accrual", reason: REASON, accountingBasisEffectiveFrom: "2000-01-01" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "pending_approval" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.env.payload.payload).not.toHaveProperty("accountingBasisEffectiveFrom");
  });

  it("flag on: a mid-year date is 422 BASIS_SWITCH_MID_YEAR and nothing is published", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const { res, sent } = await put({ accountingBasis: "accrual", reason: REASON, accountingBasisEffectiveFrom: "2000-01-01" });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("BASIS_SWITCH_MID_YEAR");
    expect(sent).toHaveLength(0);
  });

  it("flag on: no date resolves to the next 1 April and travels with the change request", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const { res, sent } = await put({ accountingBasis: "accrual", reason: REASON });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "pending_approval" });
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.env.payload.payload.accountingBasisEffectiveFrom)).toMatch(/^\d{4}-04-01$/);
  });
});

describe("PUT /v1/finance/settings budgetControl", () => {
  it("flag off: a change is refused 422 TENANT_PROFILES_DISABLED and nothing is published", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    for (const budgetControl of ["advisory", "off"]) {
      const { res, sent } = await put({ budgetControl, reason: REASON });
      expect(res.statusCode).toBe(422);
      expect(JSON.stringify(res.json())).toContain("TENANT_PROFILES_DISABLED");
      expect(sent).toHaveLength(0);
    }
  });

  it("flag off: the stored value sent unchanged is a no-op (accepted, budgetControl not applied)", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    const { res, sent } = await put({ budgetControl: "mandatory", fyCreateAsDraft: true, reason: REASON });
    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    const p = sent[0]!.env.payload as unknown as { changes: Record<string, unknown> };
    expect(p.changes).not.toHaveProperty("budgetControl");
    expect(p.changes).toMatchObject({ fyCreateAsDraft: true });
  });

  it("flag off: a body holding only the unchanged budgetControl is acknowledged without publishing", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    const { res, sent } = await put({ budgetControl: "mandatory", reason: REASON });
    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it("flag on: relaxing is held as a settings_relax change request for a second admin", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const { res, sent } = await put({ budgetControl: "advisory", reason: REASON });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "pending_approval" });
    expect(sent).toHaveLength(1);
    const p = sent[0]!.env.payload as unknown as { kind: string; payload: { changes: Record<string, unknown> } };
    expect(p.kind).toBe("settings_relax");
    expect(p.payload.changes).toMatchObject({ budgetControl: "advisory" });
  });
});

