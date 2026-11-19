#!/usr/bin/env node
/**
 * Realistic Finance seed for the pilot tenant "Municipal Corporation of Civitas Nagar"
 * (11111111-0000-0000-0000-000000000001). REST API only, idempotent, tenant-guarded.
 *
 * Clears the empty-state WARNs on /finance/journal-entry, /finance/accounting/vouchers/new,
 * /finance/period-close (period register), /finance/vendors/[id] (vendor bill) and
 * /finance/audit-paras (CAG/internal audit para flowing audit-service -> finance register).
 *
 * Usage: SEED_USER=... SEED_PASSWORD=... node scripts/seed/finance-pilot-seed.mjs [--dry-run]
 *
 * NOT seedable through the REST API (no create endpoint exists; only dev SQL seeds):
 * demand-for-grants, schemes (=> scheme-tracking, UC "new"). Payments / e-payments need a second
 * and third officer (bill passer and payer must differ from the maker) - run with real checkers.
 */
import { randomUUID } from "node:crypto";

const TENANT = "11111111-0000-0000-0000-000000000001";
const KC = process.env.KEYCLOAK_TOKEN_URL ?? "http://localhost:8180/auth/realms/civitasone/protocol/openid-connect/token";
const GW = (process.env.GATEWAY_URL ?? "http://localhost:8080").replace(/\/$/, "");
const DRY = process.argv.includes("--dry-run");
const { SEED_USER, SEED_PASSWORD } = process.env;
if (!SEED_USER || !SEED_PASSWORD) { console.error("SEED_USER and SEED_PASSWORD are required"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = null, tokenAt = 0;
async function auth() {
  if (token && Date.now() - tokenAt < 120_000) return token;
  const r = await fetch(KC, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "civitasone-web", username: SEED_USER, password: SEED_PASSWORD, grant_type: "password" }) });
  if (!r.ok) throw new Error(`token request failed: ${r.status}`);
  token = (await r.json()).access_token; tokenAt = Date.now();
  const c = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  if (c.tid !== TENANT) throw new Error(`token tid ${c.tid} is not the pilot tenant ${TENANT}; refusing`);
  return token;
}
async function api(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const t = await auth();
    await sleep(350);
    const r = await fetch(`${GW}/api/v1/${path}`, { method, headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 429) { await sleep(15_000 * (attempt + 1)); continue; }
    const text = await r.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
    return { status: r.status, json };
  }
  throw new Error(`rate limited: ${method} ${path}`);
}
const stats = {};
const tally = (k, f) => { (stats[k] ??= { created: 0, skipped: 0, failed: 0 })[f]++; };
async function must(label, method, path, body) {
  const r = await api(method, path, body);
  if (r.status >= 300) { tally(label, "failed"); throw new Error(`${label}: ${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
  return r.json;
}
async function until(fn, what, tries = 60) {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(2000); }
  throw new Error(`timed out waiting for ${what}`);
}

// 1. Period register: a period row only exists after a close, so soft-close then reopen leaves an OPEN record.
async function periods() {
  for (const period of ["2026-09", "2026-10", "2026-11"]) {
    const have = ((await must("periods", "GET", "finance/periods?limit=200")).data ?? []).find((p) => p.period === period);
    if (have) { tally("periods", "skipped"); console.log(`[skip]    period ${period} (${have.status})`); continue; }
    if (DRY) { console.log(`[dry]     period ${period}`); continue; }
    await must("periods", "POST", `finance/periods/${period}/close`, { reason: `Initialise ${period} in the period register before reopening for postings` });
    await until(async () => ((await must("periods", "GET", "finance/periods?limit=200")).data ?? []).find((p) => p.period === period), `period ${period} row`);
    await must("periods", "POST", `finance/periods/${period}/reopen`, { reason: `Reopen ${period} to accept journal and voucher postings` });
    await until(async () => ((await must("periods", "GET", "finance/periods?limit=200")).data ?? []).find((p) => p.period === period && p.status === "open"), `period ${period} open`);
    tally("periods", "created"); console.log(`[created] period ${period} open`);
  }
}

// 2. Budget allocation for the head the bill is charged to (the bill is refused NO_ALLOCATION_FOUND otherwise), then a vendor bill.
const FY = "2026-27";
const BILL = { billNo: "CNMC/WKS/2026-27/0412", poRef: "PO/CNMC/2026-27/0187", grossMinor: "18450000", billDate: "2026-11-10" };
async function vendorBill() {
  const heads = (await must("bill", "GET", "finance/accounts?limit=200")).data ?? [];
  const head = heads.find((a) => a.code === "2202" && a.type === "expense");
  if (!head) throw new Error("expense head 2202 (General Education) not found");
  const ddo = ((await must("bill", "GET", "finance/ddo")).data ?? []).find((d) => d.isActive);
  if (!ddo) throw new Error("no active DDO");
  // The vendor pinned for the /finance/vendors/[id] L1 screen (override with PILOT_VENDOR_ID).
  const vendor = await must("bill", "GET", `finance/vendors/${process.env.PILOT_VENDOR_ID ?? "0d3c7f91-9ede-4a22-bbe2-840bb8478c1d"}`);
  if (vendor.status !== "active") throw new Error("pinned vendor is not active");
  if ((vendor.bills ?? []).length) { tally("bill", "skipped"); console.log(`[skip]    vendor ${vendor.name} already has bills`); return; }
  if (DRY) { console.log(`[dry]     allocation + bill for ${vendor.name}`); return; }
  const allocs = (await must("allocation", "GET", `finance/budget-allocations?fy=${FY}&limit=500`)).data ?? [];
  if (!allocs.some((a) => a.headId === head.id)) {
    await must("allocation", "POST", "finance/budget-allocations", { headId: head.id, fy: FY, allocatedMinor: "5000000000" });
    await until(async () => ((await must("allocation", "GET", `finance/budget-allocations?fy=${FY}&limit=500`)).data ?? []).some((a) => a.headId === head.id), "allocation");
    tally("allocation", "created"); console.log("[created] allocation 2202 General Education FY 2026-27 INR 5,00,00,000");
  }
  const acc = await must("bill", "POST", "finance/bills", { ...BILL, vendorId: vendor.id, headId: head.id, ddoCode: ddo.ddoCode });
  const out = await until(async () => { const s = (await api("GET", `finance/bills/${acc.id}/status`)).json; return s && s.state !== "pending" && s.state !== "unknown" ? s : null; }, "bill outcome");
  if (out.state !== "created") { tally("bill", "failed"); throw new Error(`bill refused: ${JSON.stringify(out)}`); }
  tally("bill", "created"); console.log(`[created] bill ${out.billNo} for ${vendor.name}`);
}

// 3. CAG / internal audit paras: audit-service observation -> draft para -> issue -> response -> pending_recovery,
//    whose event lands the para (open, recoverable amount) in the finance audit-paras register.
const PARAS = [
  { obsNo: "CNMC/IA/2026-27/011", paraNo: "CAG-PARA-2026-27/3.1", deptRef: "Public Works Department", amount: "184500000", category: "financial", risk: "high",
    finding: "Road resurfacing contract RR/2025-26/14: payment released for 4.2 km against 3.6 km measured; excess payment not recovered.",
    body: "Excess payment of INR 18,45,000 on bituminous concrete work due to over-measurement in the 14th running bill; recovery to be effected from the contractor." },
  { obsNo: "CNMC/IA/2026-27/012", paraNo: "CAG-PARA-2026-27/4.2", deptRef: "Water Supply and Sewerage Department", amount: "92000000", category: "compliance", risk: "medium",
    finding: "Water connection fee receipts for 212 new connections were not deposited into the municipal fund within the prescribed time.",
    body: "Delay in remittance of INR 9,20,000 collected as connection charges; interest and explanation to be furnished by the department." },
  { obsNo: "CNMC/IA/2026-27/013", paraNo: "CAG-PARA-2026-27/6.4", deptRef: "Health and Sanitation Department", amount: "56000000", category: "financial", risk: "medium",
    finding: "Purchase of 40 sanitation handcarts without tender; rates 28% above the GeM benchmark.",
    body: "Extra expenditure of INR 5,60,000 on non-competitive procurement of sanitation equipment; justification and recovery of excess rate sought." },
];
async function auditParas() {
  const fin = (await must("audit-para", "GET", "finance/audit-paras?limit=200")).data ?? [];
  for (const p of PARAS) {
    if (fin.some((r) => r.paraNo.includes(p.paraNo) || r.paraNo === p.paraNo)) { tally("audit-para", "skipped"); continue; }
    if (DRY) { console.log(`[dry]     audit para ${p.paraNo}`); continue; }
    const listParas = async () => (await must("audit-para", "GET", "audit/paras?limit=200")).items ?? [];
    let para = (await listParas()).find((x) => x.paraNo === p.paraNo);
    if (!para) {
      let obs = ((await must("audit-para", "GET", "audit/observations?limit=200")).data ?? (await api("GET", "audit/observations?limit=200")).json ?? []);
      obs = Array.isArray(obs) ? obs : [];
      let ob = obs.find((o) => o.observationNo === p.obsNo);
      if (!ob) {
        await must("audit-para", "POST", "audit/observations", { obsNo: p.obsNo, auditeeRef: p.deptRef, finding: p.finding, category: p.category, riskLevel: p.risk, amountInvolvedMinor: p.amount, dueDate: "2026-12-31" });
        ob = await until(async () => { const l = (await api("GET", "audit/observations?limit=200")).json; return (Array.isArray(l) ? l : []).find((o) => o.observationNo === p.obsNo); }, `observation ${p.obsNo}`);
      }
      await must("audit-para", "POST", `audit/observations/${ob.id}/draft-para`, { paraNo: p.paraNo, deptRef: p.deptRef, body: p.body, sourceRef: "CAG Report 2025-26" });
      para = await until(async () => (await listParas()).find((x) => x.paraNo === p.paraNo), `para ${p.paraNo}`);
    }
    const step = async (want, method, path, body) => {
      await must("audit-para", method, `audit/paras/${para.id}/${path}`, body);
      para = await until(async () => (await listParas()).find((x) => x.id === para.id && x.status === want), `para ${p.paraNo} -> ${want}`);
    };
    if (para.status === "draft") await step("issued", "POST", "issue");
    if (para.status === "issued") await step("replied", "POST", "response", { responseBody: `Department reply: facts verified from the measurement book and cash register; recovery proceedings initiated for ${p.paraNo}.`, respondedByRef: p.deptRef });
    if (para.status === "replied") await step("pending_recovery", "PATCH", "pending_recovery", { reason: "Amount recoverable from contractor/party; entered in pending-recovery register", dueDate: "2026-12-31" });
    await until(async () => ((await must("audit-para", "GET", "finance/audit-paras?limit=200")).data ?? []).some((r) => r.paraNo.includes(p.paraNo) || r.paraNo.includes(para.id)), `finance register row ${p.paraNo}`, 20);
    tally("audit-para", "created"); console.log(`[created] audit para ${p.paraNo} (${p.deptRef})`);
  }
}

for (const [name, fn] of [["periods", periods], ["vendorBill", vendorBill], ["auditParas", auditParas]]) {
  try { await fn(); } catch (e) { console.error(`[error] ${name}: ${e.message}`); process.exitCode = 1; }
}
console.log(JSON.stringify(stats, null, 2));
