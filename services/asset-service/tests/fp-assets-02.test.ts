/**
 * fp-assets-02, real Postgres (NOBYPASSRLS app role): no hard-coded GL accounts in asset-service.
 *  - acquisition (direct + GRN) and maintenance journals take their heads from the tenant's asset_settings;
 *  - without them the record is SAVED and its journal deferred (awaiting_accounts, ASSET_GL_NOT_CONFIGURED naming the heads),
 *    never posted to a guessed account; it posts once the accounts are configured;
 *  - the new heads are validated against finance: exists, active, right type, leaf, no clash with another role.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages as outbox } from "../src/shared/outbox.js";
import { assetAssets } from "../src/modules/register/schema.js";
import { assetWorkOrders } from "../src/modules/maintenance/schema.js";
import { assetSettings, assetSettingRequests, projectAuc } from "../src/modules/enterprise/schema.js";
import { registerF3EnterpriseConsumers } from "../src/modules/enterprise/f3-consumer.js";
import { applySettingsChange } from "../src/modules/enterprise/settings-apply.js";
import { sweepDeferred, SWEEP_LIMIT } from "../src/modules/enterprise/postings.js";
import * as repo from "../src/modules/enterprise/repo.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { registerMaintenanceConsumers } from "../src/modules/maintenance/consumer.js";
import { registerRegisterConsumers } from "../src/modules/register/consumer.js";
import { COMMANDS, CONSUMED } from "../src/topics.js";
import { resetFinanceCache } from "../src/shared/finance-client.js";

const TEST_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "test_internal_secret_for_civitasone"; // gitleaks:allow
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "aaaaaaaa-1111-4000-8000-0000000fb101";
const T2 = "aaaaaaaa-1111-4000-8000-0000000fb102";
const ADMIN = "cccccccc-3333-4000-8000-0000000fb101";
const tok = (tid: string, sub: string, roles = ["asset_admin"]) => signToken({ sub, tid, roles, sid: `s-${sub.slice(-4)}` }, SECRET, 3600);
const auth = (tid = T1, sub = ADMIN, roles?: string[]) => ({ authorization: `Bearer ${tok(tid, sub, roles)}` });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(tid: string, fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(tid, () => db.transaction(fn)) as Promise<T>;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// the finance chart the asset service asks about (internal accounts lookup), faked
const CHART: Record<string, { name: string; type: string; status?: string; isLeaf?: boolean }> = {
  "1200": { name: "Fixed assets", type: "asset" },
  "1250": { name: "Accumulated depreciation", type: "asset" },
  "2050": { name: "Accounts payable control", type: "liability" },
  "2070": { name: "GRN clearing", type: "liability" },
  "2080": { name: "Payables group", type: "liability", isLeaf: false },
  "3001": { name: "Capital account", type: "equity" },
  "5300": { name: "Maintenance expense", type: "expense" },
  "5400": { name: "Repairs", type: "expense" },
  "6100": { name: "Staff cost", type: "expense", status: "inactive" },
};
function installFinanceChart(): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.includes("/v1/finance/accounts")) return real(input, init);
    if (url.includes("/system-heads")) return new Response(JSON.stringify({ accumulatedDepreciationCode: "1250" }), { status: 200 });
    const term = (new URL(url).searchParams.get("q") ?? "").toLowerCase();
    const data = Object.entries(CHART).filter(([c, v]) => c.includes(term) || v.name.toLowerCase().includes(term))
      .map(([code, v]) => ({ id: randomUUID(), code, name: v.name, type: v.type, status: v.status ?? "active", isLeaf: v.isLeaf ?? true }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
}

let app: FastifyInstance;
let q: MemoryQueue;

async function f3(op: string, payload: Record<string, unknown> = {}, tid = T1): Promise<void> {
  await q.publish(COMMANDS.f3RouteWrite, {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: tid, actorId: ADMIN, correlationId: "corr-fp02", schemaVersion: "1.0",
    payload: { op, tenantId: tid, ...payload },
  });
  await wait(500);
}
// a direct save command exactly as a client would send it (no maker-checker handling)
const setHeadsRaw = (patch: Record<string, unknown>) => f3("asset_settings_update", { reason: "configure GL", ...patch });
// head edits apply directly only while the tenant has GL maker-checker OFF; the helper turns it off first
const setHeads = async (patch: Record<string, unknown>) => { await glMcOff(); await setHeadsRaw(patch); };
const clearSettings = async (tid = T1) => asTenant(tid, async (tx) => {
  await tx.delete(assetSettings).where(eq(assetSettings.tenantId, tid));
  await tx.delete(assetSettingRequests).where(eq(assetSettingRequests.tenantId, tid));
});
const outboxFor = async (tid: string, topic: string, pred: (p: Record<string, any>) => boolean = () => true) =>
  (await asTenant(tid, (tx) => tx.select().from(outbox).where(and(eq(outbox.tenantId, tid), eq(outbox.topic, topic)))))
    .map((r) => r.payload as Record<string, any>).filter(pred);
const assetRow = async (id: string) => (await asTenant(T1, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, id))))[0]!;
const woRow = async (id: string) => (await asTenant(T1, (tx) => tx.select().from(assetWorkOrders).where(eq(assetWorkOrders.id, id))))[0]!;
const glEvent = async (topic: string, payload: Record<string, unknown>) => {
  await q.publish(topic, { messageId: randomUUID(), type: topic, tenantId: T1, actorId: ADMIN, correlationId: "c", schemaVersion: "1.0", payload });
  await wait(450);
};

async function createAsset(code: string, cost: number, acquisitionDate = "2026-08-01"): Promise<string> {
  const id = randomUUID();
  await q.publish(COMMANDS.assetCreate, {
    messageId: randomUUID(), type: COMMANDS.assetCreate, tenantId: T1, actorId: ADMIN, correlationId: "c", schemaVersion: "1.0",
    payload: { id, tenantId: T1, name: `Asset ${code}`, code, categoryId: randomUUID(), acquisitionCost: cost, acquisitionDate },
  });
  await wait(500);
  return id;
}
async function completedWorkOrder(cost: number, completedDate = "2026-08-10"): Promise<string> {
  const id = randomUUID();
  const assetId = randomUUID();
  await asTenant(T1, (tx) => tx.insert(assetWorkOrders).values({ id, tenantId: T1, assetId, scheduledDate: "2026-08-09", createdBy: ADMIN, updatedBy: ADMIN }));
  await q.publish(COMMANDS.workOrderComplete, {
    messageId: randomUUID(), type: COMMANDS.workOrderComplete, tenantId: T1, actorId: ADMIN, correlationId: "c", schemaVersion: "1.0",
    payload: { id, tenantId: T1, completedDate, costMinor: cost, currency: "INR" },
  });
  await wait(500);
  return id;
}

beforeAll(async () => {
  process.env.INTERNAL_SERVICE_SECRET = TEST_SERVICE_SECRET;
  installFinanceChart();
  app = await buildApp();
  await app.ready();
  q = new MemoryQueue();
  registerF3EnterpriseConsumers(q);
  registerMaintenanceConsumers(q);
  registerRegisterConsumers(q);
  await q.start();
});

afterAll(async () => {
  await q.stop();
  for (const t of [T1, T2]) {
    await sqlClient`delete from _outbox.messages where tenant_id = ${t}`;
    await asTenant(t, async (tx) => {
      await tx.delete(assetWorkOrders).where(eq(assetWorkOrders.tenantId, t));
      await tx.delete(assetAssets).where(eq(assetAssets.tenantId, t));
      await tx.delete(assetSettingRequests).where(eq(assetSettingRequests.tenantId, t));
      await tx.delete(projectAuc).where(eq(projectAuc.tenantId, t));
      await tx.delete(assetSettings).where(eq(assetSettings.tenantId, t));
    });
  }
  vi.restoreAllMocks();
  await app.close();
  await sqlClient.end();
});

describe("no GL account is ever guessed: records are saved, journals deferred", () => {
  it("a direct asset registration without configured accounts is SAVED with its journal awaiting accounts (ASSET_GL_NOT_CONFIGURED naming the heads)", async () => {
    await clearSettings();
    const id = await createAsset("NOGL-1", 850_000);
    const row = await assetRow(id);
    expect(row.name).toBe("Asset NOGL-1"); // the operational record is kept
    expect(row.glPostStatus).toBe("awaiting_accounts");
    expect(row.glJournalId).toBeNull();
    expect(row.glPostError).toMatch(/^ASSET_GL_NOT_CONFIGURED: .*fixed asset.*acquisition offset/);
    expect(await outboxFor(T1, "finance.gl.post", (p) => p.type === "asset_acquisition")).toHaveLength(0); // nothing posted
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.resourceId === id && p.action === "gl_deferred");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: "failure", details: { failure: "ASSET_GL_NOT_CONFIGURED", missing: ["fixed_asset", "acquisition_offset"] } });
  });

  it("a zero-cost asset has no journal at all (status none), configured or not", async () => {
    const id = await createAsset("ZERO-1", 0);
    expect((await assetRow(id)).glPostStatus).toBe("none");
  });

  it("a GRN-capitalised asset is saved and its journal deferred, naming the GRN clearing account", async () => {
    await clearSettings();
    await q.publish(CONSUMED.grnAccepted, {
      messageId: randomUUID(), type: CONSUMED.grnAccepted, tenantId: T1, actorId: ADMIN, correlationId: "c", schemaVersion: "1.0",
      payload: { grnId: `grn-${randomUUID().slice(0, 8)}`, poRef: "PO-1", vendorId: randomUUID(), items: [{ itemCode: "GRN-ITEM-1", itemName: "Server", acceptedQty: 2, rateMinor: 150_000, itemType: "fixed_asset" }] },
    });
    await wait(600);
    const [grn] = await asTenant(T1, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.code, "GRN-ITEM-1")));
    expect(grn!.acquisitionCost).toBe(300_000n);
    expect(grn!.glPostStatus).toBe("awaiting_accounts");
    expect(grn!.glPostError).toMatch(/goods-received clearing/);
  });

  it("a completed work order is kept and its maintenance journal deferred, naming the maintenance expense and AP control accounts", async () => {
    await clearSettings();
    const id = await completedWorkOrder(45_000);
    const wo = await woRow(id);
    expect(wo.status).toBe("completed");
    expect(wo.costMinor).toBe(45_000n);
    expect(wo.glPostStatus).toBe("awaiting_accounts");
    expect(wo.glPostError).toMatch(/^ASSET_GL_NOT_CONFIGURED: maintenance expense, accounts payable control/);
    expect(await outboxFor(T1, "finance.gl.post", (p) => p.type === "asset_maintenance")).toHaveLength(0);
  });

  it("configuring the accounts posts the deferred journals (and only those whose heads are now set); a repeat posts nothing twice", async () => {
    await clearSettings();
    const a = await createAsset("SWEEP-A", 100_000);
    const w = await completedWorkOrder(7_000);
    const grnId = randomUUID();
    await asTenant(T1, (tx) => tx.insert(assetAssets).values({
      id: grnId, tenantId: T1, name: "Grn asset", code: "SWEEP-G", categoryId: randomUUID(), acquisitionDate: "2026-08-02", acquisitionCost: 40_000n, bookValue: 40_000n,
      grnRef: "procurement_grn:g-1", glPostStatus: "awaiting_accounts", createdBy: ADMIN, updatedBy: ADMIN,
    }));
    // only the acquisition accounts first: the asset posts, the GRN asset (needs GRN clearing) and the work order stay deferred
    await setHeads({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" });
    expect(await assetRow(a)).toMatchObject({ glPostStatus: "pending" });
    expect((await assetRow(grnId)).glPostStatus).toBe("awaiting_accounts");
    expect((await woRow(w)).glPostStatus).toBe("awaiting_accounts");
    const acq = await outboxFor(T1, "finance.gl.post", (p) => p.type === "asset_acquisition" && p.voucherNo.includes(a.slice(0, 8)));
    expect(acq).toHaveLength(1);
    expect(acq[0]!.lines).toEqual([
      { accountCode: "1200", debitMinor: "100000", creditMinor: "0" },
      { accountCode: "2050", debitMinor: "0", creditMinor: "100000" },
    ]);
    expect(acq[0]!.postingDate).toBe("2026-08-01");
    expect((await assetRow(a)).glJournalId).toBe(acq[0]!.id);

    await setHeads({ grnClearingAccountCode: "2070", maintenanceExpenseAccountCode: "5300", apControlAccountCode: "2050" });
    expect((await assetRow(grnId)).glPostStatus).toBe("pending");
    expect((await woRow(w)).glPostStatus).toBe("pending");
    const all = await outboxFor(T1, "finance.gl.post");
    const grnJ = all.find((p) => p.voucherNo?.includes(grnId.slice(0, 8)))!;
    expect(grnJ.lines).toEqual([
      { accountCode: "1200", debitMinor: "40000", creditMinor: "0" },
      { accountCode: "2070", debitMinor: "0", creditMinor: "40000" }, // GRN path credits the GRN clearing head
    ]);
    const woAsset = String((await woRow(w)).assetId);
    const mnt = all.filter((p) => p.type === "asset_maintenance" && p.voucherNo.includes(woAsset.slice(0, 8)));
    expect(mnt).toHaveLength(1);
    expect(mnt[0]!.lines).toEqual([
      { accountCode: "5300", debitMinor: "7000", creditMinor: "0" },
      { accountCode: "2050", debitMinor: "0", creditMinor: "7000" },
    ]);

    const before = (await outboxFor(T1, "finance.gl.post")).length;
    await setHeads({ apControlAccountCode: "2050" }); // another settings write: nothing is pending any more
    expect((await outboxFor(T1, "finance.gl.post")).length).toBe(before);
  });

  it("finance's answers drive the status: posted / failed, and 'post pending journals' re-sends the failed ones (asset_admin only)", async () => {
    const a = await createAsset("FIN-A", 55_000);
    const bad = await createAsset("FIN-B", 66_000);
    const aj = (await assetRow(a)).glJournalId, bj = (await assetRow(bad)).glJournalId;
    await glEvent("finance.gl.posted", { journalId: aj });
    await glEvent("finance.gl.rejected", { journalId: bj, reason: "UNKNOWN_ACCOUNT_CODE: account 2050 is not in the chart of accounts" });
    expect((await assetRow(a)).glPostStatus).toBe("posted");
    expect(await assetRow(bad)).toMatchObject({ glPostStatus: "failed" });
    expect((await assetRow(bad)).glPostError).toMatch(/UNKNOWN_ACCOUNT_CODE/);

    expect((await app.inject({ method: "POST", url: "/v1/assets/settings/post-pending", headers: auth(T1, ADMIN, ["asset_manager"]) })).statusCode).toBe(403);
    const res = await app.inject({ method: "POST", url: "/v1/assets/settings/post-pending", headers: auth() });
    expect(res.statusCode).toBe(202);
    await f3("gl_post_pending");
    expect((await assetRow(bad)).glPostStatus).toBe("pending"); // re-sent; the posted one is untouched
    expect((await assetRow(a)).glPostStatus).toBe("posted");
    const sends = (await outboxFor(T1, "finance.gl.post", (p) => p.id === bj));
    expect(sends).toHaveLength(2); // the same deterministic journal, once more
  });
});

describe("the new heads are validated against finance (exists, active, type, leaf, no clash)", () => {
  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: "/v1/assets/settings", headers: auth(), payload: { reason: "configure GL", ...payload } });
  const refused = async (payload: Record<string, unknown>, message: RegExp) => {
    const res = await patch(payload);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("GL_HEAD_INVALID");
    expect(JSON.parse(res.body).message).toMatch(message);
  };

  it("checks existence, active status, type and leaf-ness for each new head", async () => {
    resetFinanceCache();
    await clearSettings();
    await refused({ grnClearingAccountCode: "9999" }, /does not exist/);
    await refused({ maintenanceExpenseAccountCode: "6100" }, /inactive/);
    await refused({ maintenanceExpenseAccountCode: "2050" }, /wrong account type \(expected expense, found liability\)/);
    await refused({ grnClearingAccountCode: "5300" }, /wrong account type \(expected liability, found expense\)/);
    await refused({ apControlAccountCode: "5300" }, /wrong account type/);
    await refused({ acquisitionOffsetAccountCode: "5300" }, /wrong account type \(expected liability or equity/);
    await refused({ grnClearingAccountCode: "2080" }, /group account/); // not a leaf: finance would reject the posting
    await refused({ apControlAccountCode: "1250" }, /accumulated-depreciation/);
    expect(await asTenant(T1, (tx) => tx.select().from(assetSettings).where(eq(assetSettings.tenantId, T1)))).toHaveLength(0); // nothing stored
    const ok = await patch({
      fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "3001", grnClearingAccountCode: "2070",
      maintenanceExpenseAccountCode: "5300", apControlAccountCode: "2050",
    });
    expect(ok.statusCode).toBe(202); // a capital account is a valid acquisition offset (donated assets)
  });

  it("no clash with another role: the same account cannot play two roles, except the two payable credit roles", async () => {
    await clearSettings();
    await setHeads({ fixedAssetAccountCode: "1200", grnClearingAccountCode: "2070", maintenanceExpenseAccountCode: "5300", apControlAccountCode: "2050" });
    await refused({ acquisitionOffsetAccountCode: "2070" }, /goods-received clearing and acquisition offset .* are both 2070/);
    await refused({ cwipAccountCode: "1200" }, /capital work in progress and fixed asset accounts are both 1200/);
    await refused({ apControlAccountCode: "2070" }, /both 2070/);
    // acquisition offset and AP control may be the very same payable account (what the old 2050 default did)
    expect((await patch({ acquisitionOffsetAccountCode: "2050" })).statusCode).toBe(202);
  });

  it("GET /settings reports per-area what is unset, and how many records wait", async () => {
    await clearSettings();
    await createAsset("WAIT-1", 10_000);
    await completedWorkOrder(1_000);
    const res = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/settings", headers: auth() })).body);
    expect(res.accounting.acquisition).toEqual({ configured: false, missing: ["fixed_asset", "acquisition_offset"] });
    expect(res.accounting.maintenance).toEqual({ configured: false, missing: ["maintenance_expense", "ap_control"] });
    expect(res.glOpen.assetsAwaiting).toBeGreaterThanOrEqual(1);
    expect(res.glOpen.workOrdersAwaiting).toBeGreaterThanOrEqual(1);
    await setHeads({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" });
    const after = JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/settings", headers: auth() })).body);
    expect(after.accounting.acquisition).toEqual({ configured: true, missing: [] });
    expect(after.accounting.maintenance.configured).toBe(false);
    expect(after.glOpen.assetsAwaiting).toBe(0);
  });

  it("the catalogued error ASSET_GL_NOT_CONFIGURED names the missing heads on the 409 pre-flights", async () => {
    await clearSettings();
    const id = randomUUID();
    await f3("auc_create", { id, projectCode: `CAT-${id.slice(0, 6)}`, name: "Cat", amountMinor: 100, reason: "Sanctioned" });
    const res = await app.inject({ method: "POST", url: `/v1/assets/projects/auc/${id}/capitalize`, headers: auth(), payload: { reason: "Commissioned" } });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("ASSET_GL_NOT_CONFIGURED");
    expect(body.details.missing).toEqual(["cwip", "fixed_asset"]);
    expect(body.message).toMatch(/capital work in progress, fixed asset/);
  });
});

// ── review round: second approver, locked merge, race-free sweeps, rejection reasons ──────────────────────────────────
const OTHER = "cccccccc-3333-4000-8000-0000000fb102";
const msgFor = (actorId = ADMIN) => ({ tenantId: T1, actorId, correlationId: "corr-fp02-direct" });
const glMcOff = () => asTenant(T1, (tx) => tx.insert(assetSettings).values({ tenantId: T1, updatedBy: ADMIN, glMakerChecker: false })
  .onConflictDoUpdate({ target: assetSettings.tenantId, set: { glMakerChecker: false } }));
const settingsRow = async () => (await asTenant(T1, (tx) => tx.select().from(assetSettings).where(eq(assetSettings.tenantId, T1))))[0];
const settingsGet = async () => JSON.parse((await app.inject({ method: "GET", url: "/v1/assets/settings", headers: auth() })).body);
const patchSettings = (payload: Record<string, unknown>, headers = auth()) =>
  app.inject({ method: "PATCH", url: "/v1/assets/settings", headers, payload: { reason: "configure GL", ...payload } });
async function f3As(actor: string, op: string, payload: Record<string, unknown> = {}): Promise<void> {
  await q.publish(COMMANDS.f3RouteWrite, {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: T1, actorId: actor, correlationId: "corr-fp02", schemaVersion: "1.0",
    payload: { op, tenantId: T1, ...payload },
  });
  await wait(500);
}
const settingsAudits = (pred: (p: Record<string, any>) => boolean) => outboxFor(T1, "audit.event.record", (p) => p.resourceType === "asset_settings" && pred(p));

describe("GL head edits need a second approver (default ON), and the sweep runs only after approval", () => {
  it("a head edit becomes a pending request; nothing is applied or swept until a DIFFERENT approver approves", async () => {
    await clearSettings();
    const a = await createAsset("MC-1", 12_000);
    expect((await assetRow(a)).glPostStatus).toBe("awaiting_accounts");
    const res = await patchSettings({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" });
    expect(res.statusCode).toBe(202);
    const requestId = JSON.parse(res.body).id as string;
    await f3("settings_request", { id: requestId, kind: "gl_heads_change", reason: "configure GL", heads: { fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" } });
    expect((await settingsRow())?.fixedAssetAccountCode ?? null).toBeNull(); // not applied
    expect((await assetRow(a)).glPostStatus).toBe("awaiting_accounts"); // not swept
    const g = await settingsGet();
    expect(g.glMakerChecker).toBe(true);
    expect(g.pendingRequests).toHaveLength(1);
    expect(g.pendingRequests[0]).toMatchObject({ id: requestId, kind: "gl_heads_change", requestedByMe: true, heads: { fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" } });

    // the requester cannot approve: not at the route, not at the consumer
    expect((await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${requestId}/approve`, headers: auth(), payload: {} })).statusCode).toBe(403);
    await f3("settings_request_approve", { id: requestId });
    expect((await settingsRow())?.fixedAssetAccountCode ?? null).toBeNull();
    expect(await settingsAudits((p) => p.action === "gl_heads_change_approve" && p.outcome === "failure" && p.details.failure === "SAME_ACTOR")).toHaveLength(1);

    // a finance_admin (not the requester) approves; heads apply and the deferred journal posts
    const ok = await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${requestId}/approve`, headers: auth(T1, OTHER, ["finance_admin"]), payload: {} });
    expect(ok.statusCode).toBe(202);
    await f3As(OTHER, "settings_request_approve", { id: requestId });
    expect(await settingsRow()).toMatchObject({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" });
    expect((await assetRow(a)).glPostStatus).toBe("pending");
    const req = (await asTenant(T1, (tx) => tx.select().from(assetSettingRequests).where(eq(assetSettingRequests.id, requestId))))[0]!;
    expect(req).toMatchObject({ status: "approved", decidedBy: OTHER });
    expect((await settingsGet()).pendingRequests).toHaveLength(0);
    expect(await settingsAudits((p) => p.action === "gl_heads_change_approve" && p.outcome === "success" && p.details.requestedBy === ADMIN)).toHaveLength(1);
  });

  it("a rejected request changes nothing; a direct save is refused at the consumer while the switch is ON", async () => {
    await clearSettings();
    const id = randomUUID();
    await f3("settings_request", { id, kind: "gl_heads_change", reason: "x", heads: { grnClearingAccountCode: "2070" } });
    await f3As(OTHER, "settings_request_reject", { id, reason: "wrong account" });
    expect((await settingsRow())?.grnClearingAccountCode ?? null).toBeNull();
    expect((await asTenant(T1, (tx) => tx.select().from(assetSettingRequests).where(eq(assetSettingRequests.id, id))))[0]).toMatchObject({ status: "rejected", decisionReason: "wrong account" });

    await setHeadsRaw({ grnClearingAccountCode: "2070" }); // a forged direct command, GL maker-checker still ON
    expect((await settingsRow())?.grnClearingAccountCode ?? null).toBeNull();
    expect(await settingsAudits((p) => p.details?.failure === "MAKER_CHECKER_REQUIRED")).not.toHaveLength(0);
  });

  it("approval re-validates against finance: a head that became invalid is refused and the request closed as rejected with the reason", async () => {
    await clearSettings();
    const id = randomUUID();
    await f3("settings_request", { id, kind: "gl_heads_change", reason: "x", heads: { grnClearingAccountCode: "2080" } }); // a group account
    await f3As(OTHER, "settings_request_approve", { id });
    expect((await settingsRow())?.grnClearingAccountCode ?? null).toBeNull();
    const r = (await asTenant(T1, (tx) => tx.select().from(assetSettingRequests).where(eq(assetSettingRequests.id, id))))[0]!;
    expect(r.status).toBe("rejected");
    expect(r.decisionReason).toMatch(/^GL_HEAD_INVALID: .*group account/);
    expect(await settingsAudits((p) => p.outcome === "failure" && p.details?.failure === "GL_HEAD_INVALID")).not.toHaveLength(0); // refusals are audited
  });

  it("switching GL maker-checker OFF is itself a pending request needing a second approver; once off, head edits apply directly", async () => {
    await clearSettings();
    const res = await patchSettings({ glMakerChecker: false });
    expect(res.statusCode).toBe(202);
    const id = JSON.parse(res.body).id as string;
    await f3("settings_request", { id, kind: "gl_maker_checker_off", reason: "single admin tenant" });
    expect((await settingsGet()).glMakerChecker).toBe(true);
    expect((await settingsGet()).pendingRequests[0]).toMatchObject({ kind: "gl_maker_checker_off" });
    await f3("settings_request_approve", { id }); // same actor: refused
    expect((await settingsGet()).glMakerChecker).toBe(true);
    await f3As(OTHER, "settings_request_approve", { id });
    expect((await settingsGet()).glMakerChecker).toBe(false);
    // OFF: the route publishes a direct update (no request) and the consumer applies it
    const direct = await patchSettings({ grnClearingAccountCode: "2070" });
    expect(direct.statusCode).toBe(202);
    expect((await settingsGet()).pendingRequests).toHaveLength(0);
    await setHeads({ grnClearingAccountCode: "2070" });
    expect((await settingsRow())?.grnClearingAccountCode).toBe("2070");
  });
});

describe("settings merge runs on the LOCKED row: two concurrent saves cannot both pass validation", () => {
  it("two simultaneous transactions that would put the SAME account on two heads: exactly one applies, the other is refused and audited", async () => {
    await clearSettings();
    await glMcOff();
    const run = (heads: Record<string, string>, who: string) => asTenant(T1, (tx) => applySettingsChange(tx, msgFor(who), T1, { heads, reason: "race", resourceId: T1 }));
    const [r1, r2] = await Promise.all([run({ grnClearingAccountCode: "2070" }, ADMIN), run({ acquisitionOffsetAccountCode: "2070" }, OTHER)]);
    expect([r1.ok, r2.ok].sort()).toEqual([false, true]);
    const row = (await settingsRow())!;
    expect([row.grnClearingAccountCode, row.acquisitionOffsetAccountCode].filter((c) => c === "2070")).toHaveLength(1); // never both
    const refusal = [r1, r2].find((r) => !r.ok) as { ok: false; refusal: { code: string; message: string } };
    expect(refusal.refusal.code).toBe("GL_HEAD_INVALID");
    expect(refusal.refusal.message).toMatch(/both 2070/);
    expect(await settingsAudits((p) => p.outcome === "failure" && p.details?.failure === "GL_HEAD_INVALID")).not.toHaveLength(0);
  });
});

describe("sweeps are race-free, bounded and cannot be starved", () => {
  const insertAssets = async (n: number, opts: { grn: boolean; status?: string; prefix: string }) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await asTenant(T1, (tx) => tx.insert(assetAssets).values({
        id, tenantId: T1, name: `${opts.prefix}-${i}`, code: `${opts.prefix}-${randomUUID().slice(0, 8)}`, categoryId: randomUUID(), acquisitionDate: "2026-08-02",
        acquisitionCost: 1_000n, bookValue: 1_000n, grnRef: opts.grn ? `procurement_grn:${randomUUID()}` : null,
        glPostStatus: opts.status ?? "awaiting_accounts", createdBy: ADMIN, updatedBy: ADMIN,
      }));
    }
    return ids;
  };
  const sweep = (limit: number, includeFailed = false) => asTenant(T1, (tx) => sweepDeferred(tx, msgFor(), T1, { includeFailed, limit }));

  it("two overlapping sweeps post every record exactly once, and a posted record is never reset to pending", async () => {
    await clearSettings();
    await glMcOff();
    await setHeads({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050", grnClearingAccountCode: "2070" }); // sweeps whatever exists (none yet)
    const ids = await insertAssets(10, { grn: false, prefix: "OVL" });
    const [s1, s2] = await Promise.all([sweep(50), sweep(50)]);
    expect(s1.assetsPosted + s2.assetsPosted).toBe(10); // SKIP LOCKED: no row taken twice
    for (const id of ids) expect((await assetRow(id)).glPostStatus).toBe("pending");
    for (const id of ids) expect(await outboxFor(T1, "finance.gl.post", (p) => p.voucherNo?.includes(id.slice(0, 8)))).toHaveLength(1);

    // finance answers; a late/overlapping sweep (even one that re-sends failed) must not touch a posted record
    const posted = ids[0]!;
    await glEvent("finance.gl.posted", { journalId: (await assetRow(posted)).glJournalId });
    expect((await assetRow(posted)).glPostStatus).toBe("posted");
    const late = await sweep(50, true);
    expect(late.assetsPosted).toBe(0);
    expect((await assetRow(posted)).glPostStatus).toBe("posted");
    // and the conditional flip itself refuses to overwrite a state it did not select
    const flipped = await asTenant(T1, (tx) => repo.setAssetGl(tx, T1, posted, "pending", randomUUID(), null, ["awaiting_accounts", "failed"]));
    expect(flipped).toBe(false);
    expect((await assetRow(posted)).glPostStatus).toBe("posted");
  });

  it("REAL race: a row another transaction is marking posted (lock held, uncommitted) is skipped by a concurrent sweep, not reset and not re-sent", async () => {
    await clearSettings();
    await glMcOff();
    await setHeads({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" });
    const [id] = await insertAssets(1, { grn: false, prefix: "FLIP" });
    const before = (await outboxFor(T1, "finance.gl.post")).length;
    let locked!: () => void; const lockedP = new Promise<void>((r) => { locked = r; });
    let release!: () => void; const releaseP = new Promise<void>((r) => { release = r; });
    const finance = asTenant(T1, async (tx) => {
      await tx.update(assetAssets).set({ glPostStatus: "posted" }).where(eq(assetAssets.id, id!)); // row lock held until we commit
      locked();
      await releaseP;
    });
    await lockedP;
    const swept = await sweep(10); // runs while the other transaction still holds the row
    release();
    await finance;
    expect(swept.assetsPosted).toBe(0);
    expect((await assetRow(id!)).glPostStatus).toBe("posted");
    expect((await outboxFor(T1, "finance.gl.post")).length).toBe(before);
    // and a sweep that comes after still leaves it alone
    expect((await sweep(10, true)).assetsPosted).toBe(0);
    expect((await assetRow(id!)).glPostStatus).toBe("posted");
  });

  it("bounded with `more`; rows whose heads are missing cannot starve the ones that can post", async () => {
    await clearSettings();
    await glMcOff();
    await setHeads({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050" }); // GRN clearing deliberately NOT set
    const blocked = await insertAssets(6, { grn: true, prefix: "BLK" }); // older and blocked: would fill a plain "oldest first" window
    const ready = await insertAssets(3, { grn: false, prefix: "RDY" });
    const r1 = await sweep(2);
    expect(r1).toMatchObject({ assetsPosted: 2, more: true });
    const r2 = await sweep(2);
    expect(r2).toMatchObject({ assetsPosted: 1, more: false });
    for (const id of ready) expect((await assetRow(id)).glPostStatus).toBe("pending");
    for (const id of blocked) expect((await assetRow(id)).glPostStatus).toBe("awaiting_accounts"); // still waiting for their head
  });

  it("POST /settings/post-pending tells the screen whether more are waiting", async () => {
    await clearSettings();
    await insertAssets(2, { grn: false, prefix: "WAITN" });
    const res = JSON.parse((await app.inject({ method: "POST", url: "/v1/assets/settings/post-pending", headers: auth() })).body);
    expect(res).toMatchObject({ status: "accepted", limit: SWEEP_LIMIT, more: false });
    expect(res.waiting).toBeGreaterThanOrEqual(2);
  });
});

describe("no combination of settings commands skips the GL approval (round-2 review)", () => {
  const captured: Array<Record<string, any>> = [];
  beforeAll(async () => {
    infraQueue.subscribe(COMMANDS.f3RouteWrite, async (m) => { captured.push(m.payload as Record<string, any>); });
    await infraQueue.start();
  });
  const ops = () => captured.map((c) => c.op);
  const asFinanceAdmin = () => auth(T1, OTHER, ["finance_admin"]);

  it("PATCH with heads AND glMakerChecker:true while approval is ON becomes a pending request, never a direct update", async () => {
    await clearSettings();
    captured.length = 0;
    const res = await patchSettings({ fixedAssetAccountCode: "1200", glMakerChecker: true });
    expect(res.statusCode).toBe(202);
    await wait(400);
    const mine = captured.filter((c) => c.tenantId === T1);
    expect(mine.map((c) => c.op)).toEqual(["settings_request"]);
    expect(mine[0]).toMatchObject({ kind: "gl_heads_change", heads: { fixedAssetAccountCode: "1200" } });
    expect(mine.some((c) => c.op === "asset_settings_update")).toBe(false);
  });

  it("a forged direct command with heads plus glMakerChecker:true (or capitalizeMakerChecker:true) is refused by the consumer while ON, and audited", async () => {
    await clearSettings();
    await setHeadsRaw({ fixedAssetAccountCode: "1200", glMakerChecker: true });
    await setHeadsRaw({ fixedAssetAccountCode: "1200", capitalizeMakerChecker: true });
    await setHeadsRaw({ fixedAssetAccountCode: "1200", glMakerChecker: false }); // OFF + heads in one command: the OFF is ignored, heads refused
    const row = await settingsRow();
    expect(row?.fixedAssetAccountCode ?? null).toBeNull();
    expect(row?.glMakerChecker ?? true).toBe(true);
    expect((await settingsAudits((p) => p.details?.failure === "MAKER_CHECKER_REQUIRED")).length).toBeGreaterThanOrEqual(3);
  });

  it("while OFF, a PATCH that turns it ON and sets heads applies the heads directly, then the policy is ON", async () => {
    await clearSettings();
    await glMcOff();
    captured.length = 0;
    expect((await patchSettings({ fixedAssetAccountCode: "1200", glMakerChecker: true })).statusCode).toBe(202);
    await wait(400);
    const direct = captured.filter((c) => c.tenantId === T1 && c.op === "asset_settings_update");
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({ fixedAssetAccountCode: "1200", glMakerChecker: true });
    await setHeadsRaw({ fixedAssetAccountCode: "1200", glMakerChecker: true });
    expect(await settingsRow()).toMatchObject({ fixedAssetAccountCode: "1200", glMakerChecker: true });
  });

  it("OFF together with heads in one PATCH: the OFF is a pending request and the heads a separate pending request; nothing applies", async () => {
    await clearSettings();
    captured.length = 0;
    expect((await patchSettings({ glMakerChecker: false, fixedAssetAccountCode: "1200" })).statusCode).toBe(202);
    await wait(400);
    const mine = captured.filter((c) => c.tenantId === T1);
    expect(mine.map((c) => [c.op, c.kind]).sort()).toEqual([["settings_request", "gl_heads_change"], ["settings_request", "gl_maker_checker_off"]]);
  });

  it("finance_admin may request and approve GL-head changes only: the capitalisation control stays asset_admin / super_admin", async () => {
    await clearSettings();
    captured.length = 0;
    expect((await patchSettings({ fixedAssetAccountCode: "1200" }, asFinanceAdmin())).statusCode).toBe(202);
    expect((await patchSettings({ glMakerChecker: false }, asFinanceAdmin())).statusCode).toBe(202);
    expect((await patchSettings({ capitalizeMakerChecker: false }, asFinanceAdmin())).statusCode).toBe(403);
    expect((await patchSettings({ capitalizeMakerChecker: true }, asFinanceAdmin())).statusCode).toBe(403);
    await wait(400);
    const before = captured.length;
    // a pending capitalisation-off request, made by the asset admin
    const id = randomUUID();
    await f3("settings_request", { id, kind: "maker_checker_off", reason: "small unit" });
    const approve = await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${id}/approve`, headers: asFinanceAdmin(), payload: {} });
    const reject = await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${id}/reject`, headers: asFinanceAdmin(), payload: { reason: "no thanks" } });
    expect([approve.statusCode, reject.statusCode]).toEqual([403, 403]);
    await wait(400);
    expect(captured.length).toBe(before); // nothing was published
    const byAdmin = await app.inject({ method: "POST", url: `/v1/assets/settings/requests/${id}/approve`, headers: auth(T1, OTHER, ["asset_admin"]), payload: {} });
    expect(byAdmin.statusCode).toBe(202);
  });
});

describe("finance refusals reach the record with their code, and the audit label names the right resource", () => {
  it("asset and work order rejections are audited as 'asset' / 'work_order' (not asset_lease) and keep the finance code", async () => {
    await clearSettings();
    await glMcOff();
    await setHeads({ fixedAssetAccountCode: "1200", acquisitionOffsetAccountCode: "2050", maintenanceExpenseAccountCode: "5300", apControlAccountCode: "2050" });
    const a = await createAsset("REJ-A", 9_000);
    const w = await completedWorkOrder(3_000);
    await glEvent("finance.gl.rejected", { journalId: (await assetRow(a)).glJournalId, code: "PERIOD_CLOSED", reason: "the period 2026-08 is closed" });
    await glEvent("finance.gl.rejected", { journalId: (await woRow(w)).glJournalId, code: "NOT_LEAF_ACCOUNT", reason: "account 2050 is a group account" });
    expect(await assetRow(a)).toMatchObject({ glPostStatus: "failed" });
    expect((await assetRow(a)).glPostError).toMatch(/^PERIOD_CLOSED: /);
    expect((await woRow(w)).glPostError).toMatch(/^NOT_LEAF_ACCOUNT: /);
    const audits = await outboxFor(T1, "audit.event.record", (p) => p.action === "gl_post" && p.outcome === "failure");
    expect(audits.find((p) => p.resourceId === a)).toMatchObject({ resourceType: "asset", details: { code: "PERIOD_CLOSED" } });
    expect(audits.find((p) => p.resourceId === w)).toMatchObject({ resourceType: "work_order", details: { code: "NOT_LEAF_ACCOUNT" } });
    // never silently re-dated: the rejected journal keeps its posting date until someone re-sends it
    const sends = await outboxFor(T1, "finance.gl.post", (p) => p.voucherNo?.includes(a.slice(0, 8)));
    expect(sends.every((p) => p.postingDate === "2026-08-01")).toBe(true);
  });
});

describe("no hard-coded GL accounts remain in asset-service source", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
  const src = files(join(__dirname, "..", "src")).map((p) => [p, readFileSync(p, "utf8")] as const);

  it("has no env-defaulted account code (ASSET_*_CODE ?? \"1234\") and no literal accountCode", () => {
    const offenders: string[] = [];
    for (const [p, text] of src) {
      if (/process\.env\.[A-Z_]*(CODE|ACCOUNT)[A-Z_]*\s*\?\?\s*["'`]\d/.test(text)) offenders.push(`${p}: env default`);
      if (/accountCode:\s*["'`]/.test(text)) offenders.push(`${p}: literal accountCode`);
    }
    expect(offenders).toEqual([]);
  });

  it("has no numeric GL-code literal or constant anywhere a posting is built", () => {
    const offenders: string[] = [];
    for (const [p, text] of src) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"); // comments may quote example codes
      // a constant/field holding a 3-6 digit code: const FIXED_ASSET = "1200", glHead: "2050", heads.x ?? "2070", code === "5300"
      if (/\b[A-Za-z_]*(?:ACCOUNT|Account|HEAD|Head|GL|Gl|_CODE|Code)[A-Za-z_]*\s*[:=]\s*["'`]\d{3,6}["'`]/.test(code)) offenders.push(`${p}: account-code constant`);
      if (/(?:\?\?|\|\||===?|!==?)\s*["'`]\d{4}["'`]/.test(code)) offenders.push(`${p}: numeric code fallback/compare`);
      if (/\[\s*["'`]\d{4}["'`]\s*,\s*["'`]\d{4}["'`]/.test(code)) offenders.push(`${p}: list of numeric codes`);
    }
    expect(offenders).toEqual([]);
  });

  it("no posting or settings module reads a GL account from process.env", () => {
    const postingFiles = /(postings|gl-heads|settings-apply|f3-consumer|finance-client)\.ts$|(maintenance|register)[\\/]consumer\.ts$/;
    const offenders = src.filter(([p, text]) => postingFiles.test(p) && /process\.env/.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))).map(([p]) => p);
    // finance-client legitimately reads its URL / service secret from env; those are not accounts
    expect(offenders.filter((p) => !/finance-client\.ts$/.test(p))).toEqual([]);
  });
});
