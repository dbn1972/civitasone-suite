#!/usr/bin/env node
/**
 * Realistic CRM TRANSACTIONAL seed for the pilot tenant "Municipal Corporation of Civitas Nagar"
 * (11111111-0000-0000-0000-000000000001): open opportunities (feeds /crm/opportunities and
 * /crm/forecast), connected mail/calendar accounts (/crm/linked-accounts) and opportunity
 * documents (/crm/documents register). Run AFTER crm-pilot-config-seed.mjs (needs its pipelines).
 *
 * Idempotent (natural-key lookup, create-if-absent), never updates/deletes, application REST API
 * only via the gateway with a real Keycloak token; aborts unless the token `tid` is the pilot tenant.
 *
 * Env: SEED_USER, SEED_PASSWORD (required); KEYCLOAK_TOKEN_URL, GATEWAY_URL (optional).
 * Usage: SEED_USER=... SEED_PASSWORD=... node scripts/seed/crm-pilot-transactional-seed.mjs [--dry-run]
 */
const TENANT = "11111111-0000-0000-0000-000000000001";
const KC = process.env.KEYCLOAK_TOKEN_URL ?? "http://localhost:8180/auth/realms/civitasone/protocol/openid-connect/token";
const GW = (process.env.GATEWAY_URL ?? "http://localhost:8080").replace(/\/$/, "");
const DRY = process.argv.includes("--dry-run");
const { SEED_USER, SEED_PASSWORD } = process.env;
if (!SEED_USER || !SEED_PASSWORD) { console.error("SEED_USER and SEED_PASSWORD are required"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
let token = null, tokenAt = 0;
async function auth() {
  if (token && Date.now() - tokenAt < 120_000) return token;
  const r = await fetch(KC, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "civitasone-web", username: SEED_USER, password: SEED_PASSWORD, grant_type: "password" }) });
  if (!r.ok) throw new Error(`token request failed: ${r.status}`);
  token = (await r.json()).access_token; tokenAt = Date.now();
  if (claims(token).tid !== TENANT) throw new Error(`token tid is not the pilot tenant ${TENANT}; refusing`);
  return token;
}
async function api(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const t = await auth();
    await sleep(350);
    const r = await fetch(`${GW}/api/v1/crm/${path}`, { method, headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
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
const ok = (s) => [200, 201, 202].includes(s);
const list = async (path) => { const r = await api("GET", path); if (r.status !== 200) throw new Error(`GET ${path} -> ${r.status}`); return r.json?.data ?? []; };
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

await auth();
console.log(`tenant ${TENANT} gateway ${GW}${DRY ? " (DRY RUN)" : ""}`);

// ---------- opportunities (open stages only; closed stages go through the governed close flow) ----------
const pipelines = await list("pipelines");
const pid = (name) => pipelines.find((p) => p.name === name)?.id;
const DEALS = [
  ["Citizen Grievance Resolution", "Assigned", "Ward 14 storm-water drain desilting - consolidated resident petition", 18_500_000, 21, 30, "Joint inspection by Drainage Wing"],
  ["Citizen Grievance Resolution", "In Progress", "Mohalla Nehru Nagar street-light restoration (62 fixtures)", 9_200_000, 12, 60, "Procure LED retrofit kits from rate-contract vendor"],
  ["Trade Licence Renewal", "Document Verification", "Trade licence renewal - Sharma Sweets & Namkeen, Main Bazaar", 1_250_000, 15, 35, "Verify FSSAI certificate and fire NOC"],
  ["Trade Licence Renewal", "Inspection", "Trade licence renewal - Hotel Shree Residency, Station Road", 3_800_000, 9, 60, "Schedule health-inspector site visit"],
  ["Property Tax Reassessment", "Field Survey", "Reassessment request - Plot 41, Sector 7 Housing Colony (additional floor)", 6_400_000, 28, 40, "Complete covered-area measurement survey"],
  ["Property Tax Reassessment", "Valuation Review", "Reassessment - Civitas Cold Storage Pvt Ltd, Industrial Estate", 42_000_000, 40, 70, "Valuation committee review of revised capital value"],
];
const have = new Set((await list("deals?limit=200")).map((d) => d.name));
for (const [pl, stage, name, valueMinor, closeIn, probability, nextStep] of DEALS) {
  if (have.has(name)) { tally("opportunities", "skipped"); console.log(`[skip]    opportunity: ${name}`); continue; }
  if (DRY) { console.log(`[dry]     opportunity: ${name}`); continue; }
  const pipelineId = pid(pl);
  if (!pipelineId) { tally("opportunities", "failed"); console.log(`[FAILED]  pipeline '${pl}' missing (run crm-pilot-config-seed first)`); continue; }
  const r = await api("POST", "deals", { name, pipelineId, stage, valueMinor: String(valueMinor), currency: "INR", probability,
    closeDate: inDays(closeIn), expectedCloseDate: inDays(closeIn), nextStep });
  if (ok(r.status)) { tally("opportunities", "created"); console.log(`[created] opportunity: ${name}`); }
  else { tally("opportunities", "failed"); console.log(`[FAILED]  opportunity: ${name} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
}

// ---------- connected mail/calendar accounts (provider links) ----------
const linked = new Set((await list("linked-accounts")).map((x) => `${x.provider}:${x.externalEmail}`));
for (const [provider, externalEmail, scopes] of [
  ["o365", "grievance.cell@civitasnagar.gov.in", ["mail.read", "calendars.read"]],
  ["o365", "licensing.desk@civitasnagar.gov.in", ["mail.read", "calendars.read"]],
  ["google", "revenue.dept@civitasnagar.nic.in", ["gmail.readonly", "calendar.readonly"]],
]) {
  const key = `${provider}:${externalEmail}`;
  if (linked.has(key)) { tally("linked-accounts", "skipped"); console.log(`[skip]    linked-account: ${key}`); continue; }
  if (DRY) { console.log(`[dry]     linked-account: ${key}`); continue; }
  const r = await api("POST", "linked-accounts", { provider, externalEmail, scopes });
  if (ok(r.status)) { tally("linked-accounts", "created"); console.log(`[created] linked-account: ${key}`); }
  else { tally("linked-accounts", "failed"); console.log(`[FAILED]  linked-account: ${key} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
}

// ---------- documents (presign -> PUT object -> confirm), attached to the opportunities above ----------
if (!DRY) {
  await sleep(4000); // let the async deal-create commands land
  const deals = await list("deals?limit=200");
  const DOCS = [
    ["Trade licence renewal - Sharma Sweets & Namkeen, Main Bazaar", "trade_licence_certificate", "Trade Licence Certificate - Sharma Sweets.pdf", 365],
    ["Trade licence renewal - Sharma Sweets & Namkeen, Main Bazaar", "fssai_registration", "FSSAI Registration - Sharma Sweets.pdf", 540],
    ["Trade licence renewal - Hotel Shree Residency, Station Road", "noc_fire_department", "Fire NOC - Hotel Shree Residency.pdf", 180],
    ["Reassessment request - Plot 41, Sector 7 Housing Colony (additional floor)", "approved_building_plan", "Approved Building Plan - Plot 41 Sector 7.pdf", null],
    ["Reassessment request - Plot 41, Sector 7 Housing Colony (additional floor)", "sale_deed", "Registered Sale Deed - Plot 41 Sector 7.pdf", null],
  ];
  for (const [dealName, docType, title, expiryIn] of DOCS) {
    const deal = deals.find((d) => d.name === dealName);
    if (!deal) { tally("documents", "failed"); console.log(`[FAILED]  document '${title}': opportunity not found`); continue; }
    const subject = { subjectType: "opportunity", subjectId: deal.id };
    const existing = await api("GET", `documents?subjectType=opportunity&subjectId=${deal.id}`);
    if ((existing.json?.data ?? []).some((d) => d.title === title)) { tally("documents", "skipped"); console.log(`[skip]    document: ${title}`); continue; }
    const filename = title, mimeType = "application/pdf";
    const bytes = Buffer.from(`%PDF-1.4\n% ${title}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
    const ps = await api("POST", "documents/presign", { ...subject, filename, mimeType });
    if (!ok(ps.status)) { tally("documents", "failed"); console.log(`[FAILED]  document presign '${title}' -> ${ps.status} ${JSON.stringify(ps.json).slice(0, 200)}`); continue; }
    const { storageKey, uploadUrl } = ps.json.data;
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": mimeType }, body: bytes });
    if (!put.ok) { tally("documents", "failed"); console.log(`[FAILED]  document upload '${title}' -> ${put.status}`); continue; }
    const r = await api("POST", "documents", { ...subject, docType, title, filename, storageKey, mimeType, sizeBytes: bytes.length,
      ...(expiryIn ? { expiryDate: inDays(expiryIn) } : {}) });
    if (ok(r.status)) { tally("documents", "created"); console.log(`[created] document: ${title}`); }
    else { tally("documents", "failed"); console.log(`[FAILED]  document: ${title} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
  }
}
console.log("\nsummary", JSON.stringify(stats));
process.exit(Object.values(stats).some((s) => s.failed) ? 1 : 0);
