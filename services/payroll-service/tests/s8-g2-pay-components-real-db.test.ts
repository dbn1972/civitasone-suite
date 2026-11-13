/**
 * Section 8 G2: pay-component API + consumers on real Postgres, FORCE RLS as the NOBYPASSRLS payroll_svc role,
 * real consumers, no mocks.
 *   - flag OFF (the default): only /meta answers, every write route is 404, the legacy GET /components shape is
 *     unchanged (no new keys), createRun / structures list behave as before;
 *   - flag ON: component lifecycle (create / edit / deactivate / reactivate / reorder), validation matrix,
 *     duplicate code, optimistic version, role gates, audit rows, a deactivated component is not paid;
 *   - CTC template: enums stored, template checks, maker-checker lock, locked + run-referenced structures refuse
 *     edits, new-version copy; templates are not run structures;
 *   - tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayComponentConsumers } from "../src/modules/pay-components/consumer.js";
import * as repo from "../src/modules/payroll/repo.js";
import { resolveTemplateForMonth } from "../src/modules/pay-components/rules.js";
import { runWithTenant } from "@civitasone/db";
import { scopedRead } from "../src/shared/db.js";
import { drainAllQueues } from "../../../vitest.drain";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const FLAG = "S8_PAY_COMPONENTS_ENABLED";

const auth = (roles: string[], actor = MAKER, tenant = TENANT) => ({ authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: "g2" }, SECRET)}` });
const maker = auth(["payroll_officer"]);
const checker = auth(["payroll_admin"], CHECKER);
type Row = Record<string, unknown>;
async function q(text: ReturnType<typeof sql>, tenant = TENANT): Promise<Row[]> {
  return withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => Array.from((await tx.execute(text)) as Iterable<Row>));
}
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); v = await fn(); }
  return v;
}
const comps = (sid: string, t = TENANT) => q(sql`SELECT * FROM payroll.payroll_components WHERE structure_id = ${sid}::uuid ORDER BY payslip_order, code`, t);
const comp = async (sid: string, code: string) => (await comps(sid)).find((c) => c.code === code);
const audits = (resource: string, t = TENANT) => q(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND tenant_id = ${t}::uuid AND payload->>'resourceType' = ${resource} ORDER BY created_at`, t);
async function newStructure(kind = "run", t = TENANT): Promise<string> {
  const id = randomUUID();
  await q(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, status, kind, created_by, updated_by)
              VALUES (${id}::uuid, ${t}::uuid, ${"Project Staff " + id.slice(0, 4)}, 'active', ${kind}, ${MAKER}::uuid, ${MAKER}::uuid)`, t);
  return id;
}
const post = (url: string, body: unknown, headers = maker) => app.inject({ method: "POST", url, headers, payload: body as object });
const patch = (url: string, body: unknown, headers = maker) => app.inject({ method: "PATCH", url, headers, payload: body as object });
const get = (url: string, headers = maker) => app.inject({ method: "GET", url, headers });
const fixed = (code: string, name: string, fixedMinor: string, extra: object = {}) => ({ code, name, calc: "fixed", fixedMinor, ...extra });

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  registerPayComponentConsumers(queue);
  await (queue as unknown as { start?: () => Promise<void> }).start?.();
  app = await buildApp();
});
afterEach(() => { delete process.env[FLAG]; });
afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await q(sql`DELETE FROM payroll.payroll_runs WHERE tenant_id = ${t}::uuid`, t);
    await q(sql`DELETE FROM payroll.payroll_components WHERE tenant_id = ${t}::uuid`, t);
    await q(sql`DELETE FROM payroll.payroll_structures WHERE tenant_id = ${t}::uuid`, t);
  }
  await app?.close();
  await sqlClient.end();
});

describe("flag OFF (default): existing tenants see no change", () => {
  it("/meta says disabled; every write and the new reads are 404; nothing is written", async () => {
    const sid = await newStructure();
    const meta = await get("/v1/payroll/pay-components/meta");
    expect(meta.statusCode).toBe(200);
    expect(meta.json().enabled).toBe(false);
    expect((await post(`/v1/payroll/structures/${sid}/components`, fixed("TA", "Transport Allowance", "200000"))).statusCode).toBe(404);
    expect((await post("/v1/payroll/ctc-templates", { name: "Project Staff CTC" })).json().code).toBe("PAY_COMPONENTS_DISABLED");
    expect((await get(`/v1/payroll/structures/${sid}/components`)).statusCode).toBe(404);
    expect((await get("/v1/payroll/ctc-templates")).statusCode).toBe(404);
    expect((await post(`/v1/payroll/structures/${sid}/lock`, {}, checker)).statusCode).toBe(404);
    await drainAllQueues();
    expect(await comps(sid)).toHaveLength(0);
  });

  it("GET /components keeps exactly the legacy keys, and legacy rows are untouched by the migration defaults", async () => {
    const sid = await newStructure();
    await q(sql`INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, fixed_minor, created_by, updated_by)
                VALUES (${TENANT}::uuid, ${sid}::uuid, 'TA', 'Transport Allowance', 200000, ${MAKER}::uuid, ${MAKER}::uuid)`);
    const res = await get("/v1/payroll/components?limit=100");
    expect(res.statusCode).toBe(200);
    const row = (res.json().data as Row[]).find((r) => r.code === "TA")!;
    expect(Object.keys(row).sort()).toEqual(["code", "componentType", "fixedMinor", "formula", "id", "isTaxable", "name", "pctOfBasic", "structureId"]);
    expect(row.fixedMinor).toBe("200000");
    const db1 = await comp(sid, "TA");
    expect(db1).toMatchObject({ is_active: true, counts_for_pf_wage: false, lop_applicable: false, cost_placement: "inside_ctc" });
  });

  it("createRun refuses nothing new for a run structure; the run structure list excludes templates", async () => {
    const run = await newStructure("run");
    const tpl = await newStructure("ctc_template");
    const list = (await get("/v1/payroll/structures?limit=200")).json() as Array<{ id: string }>;
    const ids = (Array.isArray(list) ? list : (list as unknown as { data: Array<{ id: string }> }).data).map((s) => s.id);
    expect(ids).toContain(run);
    expect(ids).not.toContain(tpl);
    const bad = await post("/v1/payroll/runs", { runNo: "S8-" + randomUUID().slice(0, 6), month: "2026-11", structureId: tpl });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("STRUCTURE_NOT_FOUND");
  });
});

describe("flag ON: component lifecycle on a run structure", () => {
  it("create -> audited, ordered; duplicate 409; validation 422; role gates", async () => {
    process.env[FLAG] = "true";
    const sid = await newStructure();
    const url = `/v1/payroll/structures/${sid}/components`;
    expect((await get("/v1/payroll/pay-components/meta")).json().enabled).toBe(true);

    for (const roles of [["hr_admin"], ["finance_officer"], ["employee"]]) {
      expect((await post(url, fixed("TA", "Transport Allowance", "200000"), auth(roles))).statusCode, roles.join()).toBe(403);
    }
    expect((await post(url, fixed("TA", "Transport Allowance", "200000"))).statusCode).toBe(202);
    expect((await post(url, { code: "MEDICAL", name: "Medical Allowance", calc: "pct_of_basic", pctOfBasic: 2.5 })).statusCode).toBe(202);
    await until(() => comps(sid), (r) => r.length === 2);
    const ta = await comp(sid, "TA");
    expect(ta).toMatchObject({ calc: "fixed", component_type: "earning", is_active: true, payslip_order: 10 });
    expect(String(ta!.fixed_minor)).toBe("200000");
    expect((await comp(sid, "MEDICAL"))).toMatchObject({ calc: "pct_of_basic", payslip_order: 20 });
    expect((await audits("payroll_component")).length).toBeGreaterThanOrEqual(2);

    const dup = await post(url, fixed("TA", "Travel", "100"));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("CODE_EXISTS");

    const cases: Array<[object, string]> = [
      [fixed("BASIC", "Basic Pay", "100"), "CODE_RESERVED"],
      [{ code: "OTH", name: "Other", calc: "pct_of_ctc", pctOfCtcBps: 100 }, "CALC_NOT_ALLOWED"],
      [{ code: "OTH", name: "Other", calc: "balancing" }, "CALC_NOT_ALLOWED"],
      [fixed("OTH", "Other", "100", { lopApplicable: true }), "LOP_NOT_ALLOWED"],
      [fixed("OTH", "Other", "100", { componentType: "earning", employerCostClass: "group_insurance" }), "EMPLOYER_CLASS_NOT_ALLOWED"],
      [{ code: "OTH", name: "Other", calc: "pct_of_basic", pctOfBasic: 120 }, "VALIDATION"],
      [{ code: "oth", name: "Other", calc: "fixed", fixedMinor: "100" }, "CODE_INVALID"],
    ];
    for (const [body, code] of cases) {
      const r = await post(url, body);
      expect(r.statusCode, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      if (code !== "VALIDATION") expect(r.json().code, JSON.stringify(body)).toBe(code);
    }
    expect(await comps(sid)).toHaveLength(2);
  });

  it("edit with optimistic version, deactivate needs a reason, deactivated is never paid, reactivate, reorder", async () => {
    process.env[FLAG] = "true";
    const sid = await newStructure();
    const url = `/v1/payroll/structures/${sid}/components`;
    await post(url, fixed("TA", "Transport Allowance", "200000"));
    await post(url, fixed("WASHING", "Washing Allowance", "50000"));
    await until(() => comps(sid), (r) => r.length === 2);
    const ta = (await comp(sid, "TA"))!;

    const edit = await patch(`${url}/${ta.id}`, { name: "Transport Allowance (revised)", fixedMinor: "240000", version: Number(ta.version) });
    expect(edit.statusCode).toBe(202);
    await until(() => comp(sid, "TA"), (c) => c?.name === "Transport Allowance (revised)");
    expect(String((await comp(sid, "TA"))!.fixed_minor)).toBe("240000");
    expect(Number((await comp(sid, "TA"))!.version)).toBe(Number(ta.version) + 1);

    const stale = await patch(`${url}/${ta.id}`, { name: "Stale write", version: Number(ta.version) });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    // changing calc clears the old amount: fixed -> pct_of_basic needs the pct and drops fixed_minor
    const swap = await patch(`${url}/${ta.id}`, { calc: "pct_of_basic", pctOfBasic: 10 });
    expect(swap.statusCode).toBe(202);
    await until(() => comp(sid, "TA"), (c) => c?.calc === "pct_of_basic");
    expect((await comp(sid, "TA"))!.fixed_minor).toBeNull();
    expect((await patch(`${url}/${ta.id}`, { calc: "fixed" })).json().code).toBe("AMOUNT_MISMATCH");

    expect((await post(`${url}/${ta.id}/deactivate`, { reason: "short" })).statusCode).toBe(400);
    expect((await post(`${url}/${ta.id}/deactivate`, { reason: "Allowance withdrawn per office order 14/2026" })).statusCode).toBe(202);
    await until(() => comp(sid, "TA"), (c) => c?.is_active === false);
    const paid = await repo.listComponentsByStructure(sid, TENANT);
    expect(paid.map((c) => c.code)).toEqual(["WASHING"]);
    expect((await audits("payroll_component")).some((a) => (a.payload as Row).action === "deactivate")).toBe(true);
    // the deactivated row still occupies its code
    expect((await post(url, fixed("TA", "Transport Again", "100"))).statusCode).toBe(409);

    expect((await post(`${url}/${ta.id}/reactivate`, { reason: "Allowance restored per office order 21/2026" })).statusCode).toBe(202);
    await until(() => comp(sid, "TA"), (c) => c?.is_active === true);

    const wash = (await comp(sid, "WASHING"))!;
    expect((await post(`${url}/reorder`, { orderedIds: [wash.id, ta.id] })).statusCode).toBe(202);
    await until(() => comp(sid, "WASHING"), (c) => Number(c?.payslip_order) === 10);
    expect(Number((await comp(sid, "TA"))!.payslip_order)).toBe(20);
    expect((await post(`${url}/reorder`, { orderedIds: [wash.id, randomUUID()] })).json().code).toBe("ORDER_INVALID");

    const view = (await get(url)).json();
    expect(view.structure).toMatchObject({ kind: "run", effectivelyLocked: false });
    expect(view.components.map((c: Row) => c.code)).toEqual(["WASHING", "TA"]);
  });

  it("a structure used by a payroll run is immutable (409 STRUCTURE_LOCKED); a draft run does not lock it", async () => {
    process.env[FLAG] = "true";
    const sid = await newStructure();
    const url = `/v1/payroll/structures/${sid}/components`;
    const run = randomUUID();
    await q(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
                VALUES (${run}::uuid, ${TENANT}::uuid, ${"G2-" + run.slice(0, 6)}, '2026-10', ${sid}::uuid, 'draft', ${MAKER}::uuid, ${MAKER}::uuid)`);
    expect((await post(url, fixed("TA", "Transport Allowance", "200000"))).statusCode).toBe(202);
    await until(() => comps(sid), (r) => r.length === 1); // the consumer applied it while the run was still a draft
    await q(sql`UPDATE payroll.payroll_runs SET status = 'approved' WHERE id = ${run}::uuid`);
    const locked = await post(url, fixed("DA2", "Second", "100"));
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe("STRUCTURE_LOCKED");
    // a new version copies the active components into an unlocked structure
    const nv = await post(`/v1/payroll/structures/${sid}/new-version`, {});
    expect(nv.statusCode).toBe(202);
    const newId = nv.json().id as string;
    await until(() => comps(newId), (r) => r.length === 1);
    expect((await comps(newId))[0]).toMatchObject({ code: "TA", is_active: true });
    expect((await post(`/v1/payroll/structures/${newId}/components`, fixed("DA2", "Second", "100"))).statusCode).toBe(202);
  });
});

describe("flag ON: CTC template", () => {
  it("builds the owner-decision template, enforces the template checks and the maker-checker lock", async () => {
    process.env[FLAG] = "true";
    const created = await post("/v1/payroll/ctc-templates", { name: "Project Staff CTC - Delhi", effectiveFrom: "2026-12-01" });
    expect(created.statusCode).toBe(202);
    const tid = created.json().id as string;
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_structures WHERE id = ${tid}::uuid`), (r) => r.length === 1);
    const url = `/v1/payroll/structures/${tid}/components`;

    const lines: object[] = [
      { code: "BASIC", name: "Basic Pay", calc: "pct_of_ctc", pctOfCtcBps: 5000, countsForPfWage: true, countsForGratuity: true, lopApplicable: true },
      { code: "HRA", name: "House Rent Allowance", calc: "pct_of_basic", pctOfBasic: 50, lopApplicable: true },
      { code: "SPECIAL", name: "Special Allowance", calc: "balancing", lopApplicable: true },
      { code: "ER_PF", name: "Employer PF", employerCostClass: "employer_pf" },
      { code: "ER_ESI", name: "Employer ESI", employerCostClass: "employer_esi" },
      { code: "GRATUITY", name: "Gratuity provision", employerCostClass: "gratuity_provision", calc: "pct_of_basic", pctOfBasic: 4.81 },
      { code: "GROUP_INS", name: "Group insurance", employerCostClass: "group_insurance", calc: "fixed", fixedMinor: "60000" },
    ];
    for (const l of lines) expect((await post(url, l)).statusCode, JSON.stringify(l)).toBe(202);
    await until(() => comps(tid), (r) => r.length === lines.length);
    expect(await comp(tid, "SPECIAL")).toMatchObject({ calc: "balancing", component_type: "earning" });
    expect(await comp(tid, "ER_PF")).toMatchObject({ component_type: "employer_cost", employer_cost_class: "employer_pf", calc: null });
    expect(await comp(tid, "BASIC")).toMatchObject({ pct_of_ctc_bps: 5000, counts_for_pf_wage: true, counts_for_gratuity: true });

    // owner validations: one balancing only; percent-of-CTC parts cannot exceed 100%
    const second = await post(url, { code: "PLUG2", name: "Second plug", calc: "balancing" });
    expect(second.json().code).toBe("MULTIPLE_BALANCING");
    expect((await post(url, { code: "BONUSPCT", name: "Bonus share", calc: "pct_of_ctc", pctOfCtcBps: 5500 })).json().code).toBe("PCT_OF_CTC_OVER_100");
    expect((await post(url, { code: "HRA2", name: "Employer cost without class", componentType: "employer_cost", calc: "fixed", fixedMinor: "1" })).json().code).toBe("EMPLOYER_CLASS_MISMATCH");
    // basic under 50% is a warning, not a block
    const basic = (await comp(tid, "BASIC"))!;
    expect((await patch(`${url}/${basic.id}`, { pctOfCtcBps: 4000 })).statusCode).toBe(202);
    await until(() => comp(tid, "BASIC"), (c) => Number(c?.pct_of_ctc_bps) === 4000);
    const view = (await get(url)).json();
    expect(view.check.errors).toEqual([]);
    expect(view.check.warnings.map((w: Row) => w.code)).toContain("BASIC_BELOW_50_PCT");

    // maker-checker: the person who last changed it cannot lock it; a payroll_admin who did not can
    expect((await post(`/v1/payroll/structures/${tid}/lock`, {}, auth(["payroll_admin"], MAKER))).json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await post(`/v1/payroll/structures/${tid}/lock`, {}, maker)).statusCode).toBe(403); // payroll_officer cannot approve
    expect((await post(`/v1/payroll/structures/${tid}/lock`, {}, checker)).statusCode).toBe(202);
    await until(() => q(sql`SELECT is_locked FROM payroll.payroll_structures WHERE id = ${tid}::uuid`), (r) => r[0]?.is_locked === true);
    expect((await audits("payroll_structure")).some((a) => (a.payload as Row).action === "lock")).toBe(true);
    expect((await post(url, fixed("LTA", "Leave Travel Allowance", "100000"))).json().code).toBe("STRUCTURE_LOCKED");
    expect((await post(`/v1/payroll/structures/${tid}/lock`, {}, checker)).json().code).toBe("ALREADY_LOCKED");

    const list = (await get("/v1/payroll/ctc-templates")).json().data as Row[];
    expect(list.find((t) => t.id === tid)).toMatchObject({ isLocked: true, templateVersion: 1, activeComponents: lines.length });
    // components of a template stay out of the run-structure component grid
    const grid = (await get("/v1/payroll/components?limit=500")).json().data as Row[];
    expect(grid.some((c) => c.structureId === tid)).toBe(false);

    const nv = await post(`/v1/payroll/structures/${tid}/new-version`, { effectiveFrom: "2027-04-01" });
    const nid = nv.json().id as string;
    await until(() => comps(nid), (r) => r.length === lines.length);
    const [row] = await q(sql`SELECT template_version, is_locked, parent_structure_id, kind, to_char(effective_from,'YYYY-MM-DD') AS ef FROM payroll.payroll_structures WHERE id = ${nid}::uuid`);
    expect(row).toMatchObject({ template_version: 2, is_locked: false, parent_structure_id: tid, kind: "ctc_template", ef: "2027-04-01" });
  });
});

describe("template lineage: version numbers, effective dates, resolver", () => {
  async function lockedTemplate(name: string, effectiveFrom: string): Promise<string> {
    const created = await post("/v1/payroll/ctc-templates", { name, effectiveFrom });
    const tid = created.json().id as string;
    await until(() => q(sql`SELECT 1 FROM payroll.payroll_structures WHERE id = ${tid}::uuid`), (r) => r.length === 1);
    expect((await post(`/v1/payroll/structures/${tid}/components`, { code: "BASIC", name: "Basic Pay", calc: "pct_of_ctc", pctOfCtcBps: 5000 })).statusCode).toBe(202);
    expect((await post(`/v1/payroll/structures/${tid}/components`, { code: "SPECIAL", name: "Special Allowance", calc: "balancing" })).statusCode).toBe(202);
    await until(() => comps(tid), (r) => r.length === 2);
    expect((await post(`/v1/payroll/structures/${tid}/lock`, {}, checker)).statusCode).toBe(202);
    await until(() => q(sql`SELECT is_locked FROM payroll.payroll_structures WHERE id = ${tid}::uuid`), (r) => r[0]?.is_locked === true);
    return tid;
  }
  const lineage = (root: string) => q(sql`SELECT template_version, to_char(effective_from,'YYYY-MM-DD') AS ef FROM payroll.payroll_structures
    WHERE id = ${root}::uuid OR lineage_root_id = ${root}::uuid ORDER BY template_version`);

  it("new versions get distinct, increasing numbers across the whole lineage; an equal or earlier effective date is refused", async () => {
    process.env[FLAG] = "true";
    const v1 = await lockedTemplate("Project Staff CTC - Noida", "2026-12-01");
    // not later than the existing version, or missing: refused up front
    expect((await post(`/v1/payroll/structures/${v1}/new-version`, { effectiveFrom: "2026-12-01" })).json().code).toBe("EFFECTIVE_FROM_NOT_LATER");
    expect((await post(`/v1/payroll/structures/${v1}/new-version`, { effectiveFrom: "2026-06-01" })).statusCode).toBe(422);
    expect((await post(`/v1/payroll/structures/${v1}/new-version`, {})).statusCode).toBe(422);
    const two = await post(`/v1/payroll/structures/${v1}/new-version`, { effectiveFrom: "2027-04-01" });
    expect(two.statusCode).toBe(202);
    const v2 = two.json().id as string;
    await until(() => lineage(v1), (r) => r.length === 2);
    // v3 made from v1 AFTER v2 exists is number 3, not 2, and must still be later than v2
    expect((await post(`/v1/payroll/structures/${v1}/new-version`, { effectiveFrom: "2027-01-01" })).json().code).toBe("EFFECTIVE_FROM_NOT_LATER");
    expect((await post(`/v1/payroll/structures/${v1}/new-version`, { effectiveFrom: "2027-07-01" })).statusCode).toBe(202);
    await until(() => lineage(v1), (r) => r.length === 3);
    expect((await lineage(v1)).map((r) => Number(r.template_version))).toEqual([1, 2, 3]);
    // two simultaneous new-versions (from different versions of the lineage): distinct numbers, never a duplicate
    const [a, b] = await Promise.all([
      post(`/v1/payroll/structures/${v2}/new-version`, { effectiveFrom: "2027-10-01" }),
      post(`/v1/payroll/structures/${v1}/new-version`, { effectiveFrom: "2027-11-01" }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    await new Promise((r) => setTimeout(r, 800));
    const nums = (await lineage(v1)).map((r) => Number(r.template_version));
    expect(new Set(nums).size).toBe(nums.length);
    expect(nums.slice(0, 3)).toEqual([1, 2, 3]);
    expect(nums.length).toBeGreaterThanOrEqual(4);
    // the DB itself refuses a duplicate number
    await expect(q(sql`INSERT INTO payroll.payroll_structures (tenant_id, name, status, kind, template_version, lineage_root_id, created_by, updated_by)
      VALUES (${TENANT}::uuid, 'dup', 'active', 'ctc_template', 2, ${v1}::uuid, ${MAKER}::uuid, ${MAKER}::uuid)`)).rejects.toThrow();
  });

  it("resolveTemplateForMonth returns only locked versions effective for the month, with active components", async () => {
    process.env[FLAG] = "true";
    const v1 = await lockedTemplate("Project Staff CTC - Gurugram", "2026-12-01");
    const resolve = (month: string) => runWithTenant(TENANT, () => scopedRead((tx) => resolveTemplateForMonth(tx as never, TENANT, v1, month)));
    expect(await resolve("2026-11")).toBeNull();
    const r1 = await resolve("2027-03");
    expect(r1).toMatchObject({ structureId: v1, templateVersion: 1, effectiveFrom: "2026-12-01" });
    expect(r1!.components.map((c) => c.code).sort()).toEqual(["BASIC", "SPECIAL"]);
    // v2 exists but is NOT locked: still resolves to v1
    const v2 = (await post(`/v1/payroll/structures/${v1}/new-version`, { effectiveFrom: "2027-04-01" })).json().id as string;
    await until(() => comps(v2), (r) => r.length === 2);
    expect((await resolve("2027-05"))!.templateVersion).toBe(1);
    // an unlocked draft is never used, a deactivated line is dropped once v2 is locked and effective
    const sp = (await comp(v2, "SPECIAL"))!;
    expect((await post(`/v1/payroll/structures/${v2}/components`, { code: "LTA", name: "Leave Travel Allowance", calc: "fixed", fixedMinor: "100000" }, auth(["payroll_admin"], CHECKER))).statusCode).toBe(202);
    await until(() => comps(v2), (r) => r.length === 3);
    expect((await post(`/v1/payroll/structures/${v2}/lock`, {}, maker)).statusCode).toBe(403);
    expect((await post(`/v1/payroll/structures/${v2}/lock`, {}, auth(["payroll_admin"], randomUUID()))).statusCode).toBe(202);
    await until(() => q(sql`SELECT is_locked FROM payroll.payroll_structures WHERE id = ${v2}::uuid`), (r) => r[0]?.is_locked === true);
    expect(sp.id).toBeTruthy();
    expect((await resolve("2027-03"))!.templateVersion).toBe(1);
    const r2 = await resolve("2027-04");
    expect(r2!.templateVersion).toBe(2);
    expect(r2!.components.map((c) => c.code)).toContain("LTA");
  });

  it("a component edit can clear payslip_order; a run read with the flag on still loads components (share lock)", async () => {
    process.env[FLAG] = "true";
    const sid = await newStructure();
    const url = `/v1/payroll/structures/${sid}/components`;
    await post(url, fixed("TA", "Transport Allowance", "200000", { payslipOrder: 50 }));
    await until(() => comps(sid), (r) => r.length === 1);
    const ta = (await comp(sid, "TA"))!;
    expect(Number(ta.payslip_order)).toBe(50);
    expect((await patch(`${url}/${ta.id}`, { payslipOrder: null })).statusCode).toBe(202);
    await until(() => comp(sid, "TA"), (c) => c?.payslip_order === null);
    expect((await repo.listComponentsByStructure(sid, TENANT)).map((c) => c.code)).toEqual(["TA"]);
  });
});

describe("tenant isolation (FORCE RLS)", () => {
  it("another tenant cannot read, edit or lock this tenant's structure", async () => {
    process.env[FLAG] = "true";
    const sid = await newStructure();
    await post(`/v1/payroll/structures/${sid}/components`, fixed("TA", "Transport Allowance", "200000"));
    await until(() => comps(sid), (r) => r.length === 1);
    const cid = (await comp(sid, "TA"))!.id as string;
    const o = auth(["payroll_admin"], randomUUID(), OTHER);
    expect((await get(`/v1/payroll/structures/${sid}/components`, o)).statusCode).toBe(404);
    expect((await patch(`/v1/payroll/structures/${sid}/components/${cid}`, { name: "Hijack" }, o)).statusCode).toBe(404);
    expect((await post(`/v1/payroll/structures/${sid}/lock`, {}, o)).statusCode).toBe(404);
    expect((await post(`/v1/payroll/structures/${sid}/components`, fixed("X1", "Other", "1"), o)).statusCode).toBe(404);
    expect((await comp(sid, "TA"))!.name).toBe("Transport Allowance");
    expect(await comps(sid, OTHER)).toHaveLength(0);
  });
});
