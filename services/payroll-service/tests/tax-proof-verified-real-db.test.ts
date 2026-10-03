/**
 * GAP-PAYROLL-TAX-DECLARATION-02 -- tax uses the VERIFIED proof amount after the
 * tenant's proof cutoff. Real Postgres (FORCE RLS, payroll_svc), real consumers,
 * through buildApp(). Before the cutoff everything is byte-identical to the
 * declared-amount behaviour.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  fetchPayrollInput: vi.fn(async () => { throw new (await importOriginal<typeof import("../src/shared/hrms-client.js")>()).HrmsUnavailableError("down"); }),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
  resolveActorEmployeeId: vi.fn(async () => null),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerTaxProofConsumers } from "../src/modules/tax-proofs/consumer.js";
import { resolveDeclarationsTx } from "../src/modules/payroll/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN = randomUUID();
const OFFICER = randomUUID();
const FY = "2025-26";
const auth = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "verified-tds" }, SECRET)}` });
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);
let app: Awaited<ReturnType<typeof buildApp>>;
const settle = () => new Promise((r) => setTimeout(r, 350));

const E_VERIFIED = randomUUID();   // partly accepted, one rejected, one pending
const E_NOPROOF = randomUUID();    // declared but nothing uploaded
const E_OVER = randomUUID();       // accepted more than declared

async function exec(q: ReturnType<typeof sql>) {
  return runWithTenant(TENANT, () => db.transaction(async (tx) => rowsOf(await tx.execute(q))));
}
async function declare(employee: string, c: number, d: number, other: number, rent: number, fy = FY) {
  await exec(sql`
    INSERT INTO payroll.payroll_tax_declarations (id, tenant_id, employee_id, fy, regime, section_80c, section_80d, other_deductions, rent_paid_minor, hra_claimed, created_by)
    VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, ${employee}::uuid, ${fy}, 'old', ${c}, ${d}, ${other}, ${rent}, ${rent / 4}, ${ADMIN}::uuid)`);
}
async function proof(employee: string, line: string, status: string, amount: number, fy = FY) {
  await exec(sql`
    INSERT INTO payroll.tax_proofs (id, tenant_id, employee_id, fy, line, storage_key, filename, content_type, size_bytes, amount_minor, status, rejection_reason, uploaded_by)
    VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, ${employee}::uuid, ${fy}, ${line}, ${`payroll/${TENANT}/tax-proofs/${fy}/${employee}/${randomUUID()}.pdf`}, 'p.pdf', 'application/pdf', 100, ${amount}, ${status},
            ${status === "rejected" ? "illegible" : null}, ${OFFICER}::uuid)`);
}
const decl = async (asOf: string | undefined, employees = [E_VERIFIED, E_NOPROOF, E_OVER], fy = FY) =>
  runWithTenant(TENANT, () => db.transaction((tx) => resolveDeclarationsTx(tx as unknown as typeof db, TENANT, employees, fy, asOf)));
// The tenant is opted in from FY 2025-26 unless a test says otherwise (NULL = off, the default for every tenant).
const setCutoff = async (md: string | null, from: string | null = FY) =>
  exec(sql`INSERT INTO payroll.payroll_settings (tenant_id, tax_proof_cutoff_md, tax_proof_verified_from_fy)
           VALUES (${TENANT}::uuid, ${md ?? "01-31"}, ${from})
           ON CONFLICT (tenant_id) DO UPDATE SET tax_proof_cutoff_md = EXCLUDED.tax_proof_cutoff_md, tax_proof_verified_from_fy = EXCLUDED.tax_proof_verified_from_fy`);

beforeAll(async () => {
  const q0 = queue as unknown as { subscribe: (t: string, h: (m: { tenantId: string }) => Promise<void>) => void; start?: () => Promise<void> };
  const raw = q0.subscribe.bind(q0);
  registerTaxProofConsumers({
    ...queue,
    subscribe: (topic: string, handler: (m: { tenantId: string }) => Promise<void>) => raw(topic, (m) => runWithTenant(m.tenantId, () => handler(m))),
  } as unknown as Parameters<typeof registerTaxProofConsumers>[0]);
  await q0.start?.();
  app = await buildApp();

  // Declared: 80C 2,00,000 / 80D 25,000 / other 30,000 / rent 2,40,000 (paise).
  await declare(E_VERIFIED, 200_000_00, 25_000_00, 30_000_00, 240_000_00);
  await declare(E_NOPROOF, 150_000_00, 25_000_00, 0, 120_000_00);
  await declare(E_OVER, 100_000_00, 10_000_00, 5_000_00, 60_000_00);
  // E_VERIFIED: 80C accepted 60,000 + 40,000 = 1,00,000; one rejected 50,000; one pending 30,000; 80D rejected; other: 80G accepted 12,000; rent accepted 1,20,000.
  await proof(E_VERIFIED, "sec80c", "accepted", 60_000_00);
  await proof(E_VERIFIED, "sec80c", "accepted", 40_000_00);
  await proof(E_VERIFIED, "sec80c", "rejected", 50_000_00);
  await proof(E_VERIFIED, "sec80c", "pending", 30_000_00);
  await proof(E_VERIFIED, "sec80d", "rejected", 25_000_00);
  await proof(E_VERIFIED, "sec80g", "accepted", 12_000_00);
  await proof(E_VERIFIED, "rent", "accepted", 120_000_00);
  // E_OVER: accepted far more than declared everywhere.
  await proof(E_OVER, "sec80c", "accepted", 500_000_00);
  await proof(E_OVER, "sec80d", "accepted", 90_000_00);
  await proof(E_OVER, "other", "accepted", 80_000_00);
  await proof(E_OVER, "rent", "accepted", 900_000_00);
});

afterEach(() => { vi.useRealTimers(); });

afterAll(async () => {
  await app?.close();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.tax_proofs WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.payroll_tax_declarations WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
  }));
  await sqlClient.end();
});

describe("payroll TDS projection input (resolveDeclarationsTx)", () => {
  it("BEFORE the cutoff (default 31 Jan) the declared amounts are used, identical to no asOf at all", async () => {
    await setCutoff(null);
    const legacy = await decl(undefined);
    const onCutoffDay = await decl("2026-01-31");
    const earlier = await decl("2025-12-01");
    expect(onCutoffDay).toEqual(legacy);
    expect(earlier).toEqual(legacy);
    expect(legacy.get(E_VERIFIED)).toMatchObject({ ded80cMinor: 200_000_00n, ded80dMinor: 25_000_00n, otherDedMinor: 30_000_00n, rentPaidAnnualMinor: 240_000_00n });
    expect(legacy.get(E_NOPROOF)).toMatchObject({ ded80cMinor: 150_000_00n });
  });

  it("AFTER the cutoff only accepted proofs count: rejected and pending are zero, no proof is zero", async () => {
    await setCutoff(null);
    const after = await decl("2026-02-01");
    expect(after.get(E_VERIFIED)).toMatchObject({
      ded80cMinor: 100_000_00n,   // 60k + 40k accepted; rejected 50k and pending 30k ignored
      ded80dMinor: 0n,            // only a rejected proof
      otherDedMinor: 12_000_00n,  // 80G proof feeds "other deductions"
      rentPaidAnnualMinor: 120_000_00n,
    });
    expect(after.get(E_NOPROOF)).toMatchObject({ ded80cMinor: 0n, ded80dMinor: 0n, otherDedMinor: 0n, rentPaidAnnualMinor: 0n });
  });

  it("caps the verified amount at the declared amount", async () => {
    const after = await decl("2026-03-15");
    expect(after.get(E_OVER)).toMatchObject({ ded80cMinor: 100_000_00n, ded80dMinor: 10_000_00n, otherDedMinor: 5_000_00n, rentPaidAnnualMinor: 60_000_00n });
  });

  it("the cutoff is per tenant: moving it to 31 March keeps Feb declared; a past FY (Form 16 time) is always after", async () => {
    await setCutoff("03-31");
    const feb = await decl("2026-02-01");
    expect(feb.get(E_VERIFIED)).toMatchObject({ ded80cMinor: 200_000_00n });
    expect((await decl("2026-03-31")).get(E_VERIFIED)).toMatchObject({ ded80cMinor: 200_000_00n });
    expect((await decl("2026-04-01")).get(E_VERIFIED)).toMatchObject({ ded80cMinor: 100_000_00n });
    await setCutoff(null);
  });
});

describe("per-tenant opt-in (tax_proof_verified_from_fy)", () => {
  it("flag OFF (NULL, the default): declared amounts everywhere, even long after the cutoff and for a closed FY", async () => {
    await exec(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`); // no settings row at all
    const legacy = await decl(undefined);
    expect(await decl("2026-10-03")).toEqual(legacy);
    expect(await decl("2027-03-31")).toEqual(legacy);
    await setCutoff(null, null); // row exists, flag NULL
    expect(await decl("2026-10-03")).toEqual(legacy);
    // the read routes too (FY 2025-26 is closed "today"): declared, byte-identical to before the feature
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T05:00:00Z"));
    const res = await app.inject({ method: "GET", url: `/v1/payroll/income-tax?fy=${FY}`, headers: auth(ADMIN, ["payroll_admin"]) });
    expect((res.json() as { data: Row[] }).data.map((r) => Number(r.deductions80C)).sort((a, b) => a - b)).toEqual([100_000, 150_000, 150_000]);
    await setCutoff(null);
  });

  it("flag ON from FY X: verified after the cutoff for FY >= X only; earlier FYs stay declared", async () => {
    const FY2 = "2026-27";
    await declare(E_VERIFIED, 200_000_00, 25_000_00, 30_000_00, 240_000_00, FY2);
    await proof(E_VERIFIED, "sec80c", "accepted", 90_000_00, FY2);
    await setCutoff(null, FY2); // opted in from 2026-27
    // FY 2025-26 (before the flag): declared even though its cutoff has long passed
    expect((await decl("2026-10-03")).get(E_VERIFIED)).toMatchObject({ ded80cMinor: 200_000_00n });
    // FY 2026-27: declared until the cutoff (31 Jan 2027), verified after
    expect((await decl("2027-01-31", [E_VERIFIED], FY2)).get(E_VERIFIED)).toMatchObject({ ded80cMinor: 200_000_00n });
    expect((await decl("2027-02-01", [E_VERIFIED], FY2)).get(E_VERIFIED)).toMatchObject({ ded80cMinor: 90_000_00n, ded80dMinor: 0n });
    // a later FY inherits the switch
    await setCutoff(null, "2025-26");
    expect((await decl("2027-02-01", [E_VERIFIED], FY2)).get(E_VERIFIED)).toMatchObject({ ded80cMinor: 90_000_00n });
    await setCutoff(null);
  });

  it("is set through the settings route by payroll_admin only, audited before/after, and null switches it off", async () => {
    await exec(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
    const put = (roles: string[], body: unknown, sub = randomUUID()) =>
      app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(sub, roles), payload: body as never });
    for (const roles of [["payroll_officer"], ["tenant_admin"], ["super_admin"], ["hr_admin"]]) {
      expect((await put(roles, { taxProofVerifiedFromFy: "2026-27" })).statusCode, roles.join()).toBe(403);
    }
    for (const bad of ["2026", "2026-28", "FY26", 2026]) expect((await put(["payroll_admin"], { taxProofVerifiedFromFy: bad })).statusCode, String(bad)).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs/settings", headers: auth(ADMIN, ["payroll_admin"]) })).json()).toMatchObject({ taxProofVerifiedFromFy: null, canEditVerifiedFrom: true });
    expect((await put(["payroll_admin"], { taxProofVerifiedFromFy: "2026-27", reason: "Proof drive completed for FY 2026-27" }, ADMIN)).statusCode).toBe(202);
    await settle();
    expect((await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs/settings", headers: auth(ADMIN, ["payroll_admin"]) })).json()).toMatchObject({ taxProofVerifiedFromFy: "2026-27" });
    expect((await put(["payroll_admin"], { taxProofVerifiedFromFy: null }, ADMIN)).statusCode).toBe(202);
    await settle();
    const trail = await exec(sql`SELECT actor_id, payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'action' = 'verified_tds_update' AND payload->>'resourceId' = ${TENANT} ORDER BY created_at`);
    expect(trail.map((r) => (r.payload as { details: unknown }).details)).toEqual([
      { before: { taxProofVerifiedFromFy: null }, after: { taxProofVerifiedFromFy: "2026-27" }, reason: "Proof drive completed for FY 2026-27" },
      { before: { taxProofVerifiedFromFy: "2026-27" }, after: { taxProofVerifiedFromFy: null }, reason: null },
    ]);
    await expect(exec(sql`UPDATE payroll.payroll_settings SET tax_proof_verified_from_fy = 'garbage' WHERE tenant_id = ${TENANT}::uuid`)).rejects.toThrow();
    await setCutoff(null);
  });
});

describe("income-tax listing and computation read the same selection", () => {
  const listing = async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/income-tax?fy=${FY}`, headers: auth(ADMIN, ["payroll_admin"]) });
    expect(res.statusCode).toBe(200);
    const byId = new Map<string, Row>();
    for (const r of (res.json() as { data: Row[] }).data) byId.set(String(r.employee), r);
    return res.json() as { data: Row[] };
  };
  // the listing has no HRMS identity here, so rows are keyed by declaration id; match on deductions instead
  const deductions = (rows: Row[]) => rows.map((r) => Number(r.deductions80C)).sort((a, b) => a - b);

  it("before the cutoff: declared 80C (capped by the unchanged engine at 1,50,000)", async () => {
    await setCutoff(null);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T05:00:00Z"));
    const { data } = await listing();
    expect(deductions(data)).toEqual([100_000, 150_000, 150_000]); // E_OVER 1L declared, E_NOPROOF 1.5L, E_VERIFIED 2L -> cap 1.5L
  });

  it("after the cutoff: verified only, capped at declared and at the limit; unverified = 0", async () => {
    await setCutoff(null);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));
    const { data } = await listing();
    expect(deductions(data)).toEqual([0, 100_000, 100_000]); // E_NOPROOF 0, E_VERIFIED 1L verified, E_OVER min(5L,1L declared)
  });

  it("the computation route follows the same switch (single employee, old regime)", async () => {
    await setCutoff(null);
    const url = `/v1/payroll/tax/computation?fy=${FY}&employeeId=${E_VERIFIED}&regime=old`;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T05:00:00Z"));
    const before = await app.inject({ method: "GET", url, headers: auth(ADMIN, ["payroll_admin"]) });
    vi.setSystemTime(new Date("2026-02-10T05:00:00Z"));
    const after = await app.inject({ method: "GET", url, headers: auth(ADMIN, ["payroll_admin"]) });
    expect([before.statusCode, after.statusCode]).toEqual([200, 200]);
    const b = before.json() as { exemptions: number };
    const a = after.json() as { exemptions: number };
    // before: 80C 1,50,000 (limit) + 80D 25,000 + HRA 60,000 + other 30,000 + standard deduction 50,000
    expect(b.exemptions).toBe(315_000);
    // after: 80C 1,00,000 verified + 80D 0 (rejected) + HRA 0 (half the rent unverified: 60,000 - 1,20,000 < 0) + other 12,000 + 50,000
    expect(a.exemptions).toBe(162_000);
  });
});

describe("cutoff setting", () => {
  it("defaults to 01-31; only payroll_admin edits it; before/after audited; invalid values are refused", async () => {
    await setCutoff(null);
    const get = await app.inject({ method: "GET", url: "/v1/payroll/tax-proofs/settings", headers: auth(ADMIN, ["payroll_admin"]) });
    expect(get.json()).toMatchObject({ taxProofCutoff: "01-31", defaultCutoff: "01-31", canEditCutoff: true });

    for (const roles of [["payroll_officer"], ["tenant_admin"], ["super_admin"], ["hr_admin"]]) {
      const res = await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(randomUUID(), roles), payload: { taxProofCutoff: "02-28" } });
      expect(res.statusCode, roles.join()).toBe(403);
    }
    for (const bad of ["2026-01-31", "13-01", "02-30", "jan", ""]) {
      expect((await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(ADMIN, ["payroll_admin"]), payload: { taxProofCutoff: bad } })).statusCode, bad).toBe(400);
    }
    expect((await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(ADMIN, ["payroll_admin"]), payload: {} })).statusCode).toBe(400);

    expect((await app.inject({ method: "PUT", url: "/v1/payroll/tax-proofs/settings", headers: auth(ADMIN, ["payroll_admin"]), payload: { taxProofCutoff: "02-28", reason: "Board extended proof window" } })).statusCode).toBe(202);
    await settle();
    expect((await exec(sql`SELECT tax_proof_cutoff_md AS md FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`))[0]!.md).toBe("02-28");
    const trail = await exec(sql`SELECT actor_id, payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'action' = 'cutoff_update' AND payload->>'resourceId' = ${TENANT}`);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.actor_id).toBe(ADMIN);
    expect(trail[0]!.payload).toMatchObject({ details: { before: { taxProofCutoff: "01-31" }, after: { taxProofCutoff: "02-28" }, reason: "Board extended proof window" } });
    await expect(exec(sql`UPDATE payroll.payroll_settings SET tax_proof_cutoff_md = '13-45' WHERE tenant_id = ${TENANT}::uuid`)).rejects.toThrow();
    await setCutoff(null);
  });
});
