#!/usr/bin/env node
/**
 * Realistic CRM configuration seed for the pilot tenant
 * "Municipal Corporation of Civitas Nagar" (11111111-0000-0000-0000-000000000001).
 *
 * Idempotent: every resource is looked up by its natural key (name / code) and skipped if present.
 * Never deletes or updates anything. Goes through the gateway with a real Keycloak token (the same
 * password-grant path the UAT sweep uses); aborts unless the token's `tid` is the pilot tenant.
 *
 * Env: SEED_USER, SEED_PASSWORD (required); KEYCLOAK_TOKEN_URL, GATEWAY_URL (optional).
 * Usage: SEED_USER=... SEED_PASSWORD=... node scripts/seed/crm-pilot-config-seed.mjs [--dry-run]
 */
import { randomUUID } from "node:crypto";

const TENANT = "11111111-0000-0000-0000-000000000001";
const KC = process.env.KEYCLOAK_TOKEN_URL ?? "http://localhost:8180/auth/realms/civitasone/protocol/openid-connect/token";
const GW = (process.env.GATEWAY_URL ?? "http://localhost:8080").replace(/\/$/, "");
const DRY = process.argv.includes("--dry-run");
const { SEED_USER, SEED_PASSWORD } = process.env;
if (!SEED_USER || !SEED_PASSWORD) { console.error("SEED_USER and SEED_PASSWORD are required"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
let token = null, tokenAt = 0, actorId = null;
async function auth() {
  if (token && Date.now() - tokenAt < 120_000) return token;
  const r = await fetch(KC, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "civitasone-web", username: SEED_USER, password: SEED_PASSWORD, grant_type: "password" }) });
  if (!r.ok) throw new Error(`token request failed: ${r.status}`);
  token = (await r.json()).access_token; tokenAt = Date.now();
  const c = claims(token);
  if (c.tid !== TENANT) throw new Error(`token tid ${c.tid} is not the pilot tenant ${TENANT}; refusing`);
  actorId = c.sub;
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
const list = async (path) => { const r = await api("GET", path); if (r.status !== 200) throw new Error(`GET ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return r.json?.data ?? []; };

/** Create-if-absent by natural key. */
async function ensure(label, listPath, keyOf, items, createPath, method = "POST") {
  const have = new Set((await list(listPath)).map(keyOf));
  for (const it of items) {
    const key = keyOf(it);
    if (have.has(key)) { tally(label, "skipped"); console.log(`[skip]    ${label}: ${key}`); continue; }
    if (DRY) { console.log(`[dry]     ${label}: ${key}`); continue; }
    const r = await api(method, createPath, it);
    if ([200, 201, 202].includes(r.status)) { tally(label, "created"); console.log(`[created] ${label}: ${key} (${r.status})`); }
    else if (r.status === 409) { tally(label, "skipped"); console.log(`[skip]    ${label}: ${key} (409 exists)`); }
    else { tally(label, "failed"); console.log(`[FAILED]  ${label}: ${key} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
  }
}

await auth();
console.log(`tenant ${TENANT} actor ${actorId} gateway ${GW}${DRY ? " (DRY RUN)" : ""}`);

// ---------- pipelines ----------
const stage = (name, probability, ordinal, extra = {}) => ({ id: randomUUID(), name, probability, ordinal, ...extra });
await ensure("pipelines", "pipelines", (p) => p.name, [
  { name: "Citizen Grievance Resolution", businessUnit: "Public Grievance Cell",
    stages: [stage("Received", 10, 0), stage("Assigned", 30, 1), stage("In Progress", 60, 2), stage("Resolved", 90, 3, { gate: true }), stage("Closed", 100, 4)] },
  { name: "Trade Licence Renewal", businessUnit: "Licensing Department",
    stages: [stage("Application Received", 10, 0), stage("Document Verification", 35, 1, { mandatoryFields: ["closeDate"] }), stage("Inspection", 60, 2), stage("Fee Payment", 85, 3), stage("Licence Issued", 100, 4)] },
  { name: "Property Tax Reassessment", businessUnit: "Revenue Department",
    stages: [stage("Request Logged", 10, 0), stage("Field Survey", 40, 1), stage("Valuation Review", 70, 2), stage("Demand Notice Issued", 100, 3)] },
], "pipelines");

// ---------- code masters ----------
await ensure("service-types", "service-types", (x) => x.code, [
  ["new_water_connection", "New Water Connection", 720, 1], ["trade_licence_renewal", "Trade Licence Renewal", 240, 2],
  ["birth_certificate", "Birth Certificate", 72, 3], ["death_certificate", "Death Certificate", 72, 4],
  ["building_plan_approval", "Building Plan Approval", 1080, 5], ["property_tax_assessment", "Property Tax Assessment", 480, 6],
  ["sewerage_connection", "Sewerage Connection", 600, 7], ["marriage_registration", "Marriage Registration", 168, 8],
].map(([code, label, slaHours, sortOrder]) => ({ code, label, slaHours, sortOrder, active: true })), "service-types");

await ensure("grievance-categories", "grievance-categories", (x) => x.code, [
  ["water_supply", "Water Supply"], ["sanitation_solid_waste", "Sanitation & Solid Waste"], ["street_lighting", "Street Lighting"],
  ["road_footpath_maintenance", "Road & Footpath Maintenance"], ["property_tax", "Property Tax"], ["building_permissions", "Building Permissions"],
  ["drainage_sewerage", "Drainage & Sewerage"], ["parks_gardens", "Parks & Gardens"],
].map(([code, label], i) => ({ code, label, sortOrder: i + 1, active: true })), "grievance-categories");

await ensure("document-types", "document-types", (x) => x.code, [
  ["aadhaar_card", "Aadhaar Card (Identity Proof)", ["contact", "lead"], true, false, true],
  ["address_proof", "Address Proof (Electricity Bill / Ration Card)", ["contact", "lead", "case"], true, false, true],
  ["property_tax_receipt", "Property Tax Receipt", ["account", "case"], false, false, true],
  ["sale_deed", "Registered Sale Deed", ["case", "opportunity"], false, false, true],
  ["trade_licence_certificate", "Trade Licence Certificate", ["account", "case"], true, true, true],
  ["fssai_registration", "FSSAI Registration Certificate", ["account"], false, true, true],
  ["approved_building_plan", "Approved Building Plan", ["case", "opportunity"], false, false, true],
  ["noc_fire_department", "No-Objection Certificate (Fire Department)", ["case"], false, true, true],
].map(([code, name, appliesTo, mandatory, expiryRequired, verificationRequired]) => ({ code, name, appliesTo, mandatory, expiryRequired, verificationRequired, enabled: true })), "document-types");

// ---------- custom fields ----------
for (const [entityType, fields] of Object.entries({
  contacts: [["ward_number", "number", { required: true }, 0], ["property_id", "text", { required: false }, 1],
    ["preferred_language", "select", { options: ["Hindi", "English", "Marathi", "Urdu", "Bengali"] }, 2],
    ["aadhaar_last4", "text", { sensitive: true, visibleToRoles: ["super_admin", "tenant_admin"] }, 3]],
  leads: [["enquiry_channel", "select", { options: ["Walk-in", "Helpline 1800", "Web Portal", "Mobile App", "Ward Office"] }, 0],
    ["ward_number", "number", { required: true }, 1], ["is_senior_citizen", "boolean", {}, 2]],
  deals: [["application_number", "text", { required: true }, 0], ["fee_waiver_applicable", "boolean", {}, 1],
    ["statutory_deadline", "date", {}, 2]],
})) {
  await ensure(`custom-fields:${entityType}`, `custom-fields/${entityType}`, (x) => x.fieldName,
    fields.map(([fieldName, fieldType, validationSchema, ordinal]) => ({ entityType, fieldName, fieldType, validationSchema, ordinal })), "custom-fields");
}

// ---------- price books (municipal fee schedules) ----------
await ensure("price-books", "price-books", (x) => x.name, [
  { name: "Residential Fee Schedule FY 2026-27", segment: "Residential", geography: "Civitas Nagar - All Wards", channel: "Citizen Service Centre", priority: 10 },
  { name: "Commercial Fee Schedule FY 2026-27", segment: "Commercial", geography: "Civitas Nagar - All Wards", channel: "Citizen Service Centre", priority: 20 },
  { name: "Industrial Area Fee Schedule FY 2026-27", segment: "Industrial", geography: "Industrial Estate Zone", channel: "Licensing Counter", priority: 30 },
  { name: "Senior Citizen Concessional Schedule", segment: "Senior Citizen", geography: "Civitas Nagar - All Wards", channel: "Ward Office", priority: 5 },
].map((b) => ({ ...b, currency: "INR", enabled: true })), "price-books");

// ---------- assignment structure ----------
const owner = actorId;
await ensure("territories", "territories", (x) => x.name, [
  ["North Zone", "NZ", "Zone 1"], ["South Zone", "SZ", "Zone 2"], ["East Zone", "EZ", "Zone 3"], ["West Zone", "WZ", "Zone 4"], ["Central Zone", "CZ", "Zone 5"],
].map(([name, code, region]) => ({ name, code, region, ownerId: owner })), "territories");
await ensure("assignment-queues", "assignment-queues", (x) => x.name, [
  ["Water Supply & Sewerage Desk", "Complaints and connection requests for water supply and sewerage"],
  ["Sanitation & Solid Waste Desk", "Garbage collection, street sweeping and waste-processing grievances"],
  ["Roads & Street Lighting Desk", "Potholes, footpaths and street light faults"],
  ["Revenue & Property Tax Desk", "Assessment, demand notice and payment queries"],
  ["Licensing & Trade Desk", "Trade licence applications and renewals"],
  ["Building Permissions Desk", "Plan approvals, completion and occupancy certificates"],
].map(([name, description]) => ({ name, description, enabled: true })), "assignment-queues");
await ensure("branches", "branches", (x) => x.name, [
  ["Civitas Nagar Civic Centre", "CC-01"], ["North Zone Ward Office", "WO-NZ"], ["South Zone Ward Office", "WO-SZ"], ["East Zone Ward Office", "WO-EZ"], ["West Zone Ward Office", "WO-WZ"],
].map(([name, code]) => ({ name, code })), "branches");
await ensure("partners", "partners", (x) => x.name, [
  ["Jan Seva Kendra Franchise Network", "csc_operator"], ["Civitas Nagar Residents' Welfare Federation", "rwa"], ["Nagar Vyapar Mandal (Traders' Association)", "trade_body"],
].map(([name, partnerType]) => ({ name, partnerType, ownerId: owner })), "partners");

await ensure("assignment-rules", "assignment-rules", (x) => x.name, [
  { name: "North Zone leads to North Zone Desk", ruleType: "territory", criteria: { territory: "North Zone", ownerId: owner }, ordinal: 10 },
  { name: "South Zone leads to South Zone Desk", ruleType: "territory", criteria: { territory: "South Zone", ownerId: owner }, ordinal: 20 },
  { name: "Water connection enquiries to Water Supply Desk", ruleType: "product", criteria: { value: "New Water Connection", ownerId: owner }, ordinal: 30 },
  { name: "Senior citizen priority handling", ruleType: "segment", criteria: { value: "Senior Citizen", ownerId: owner }, ordinal: 40 },
  { name: "Hindi-language helpline routing", ruleType: "language", criteria: { value: "Hindi", ownerId: owner }, ordinal: 50 },
  { name: "High-priority leads (score 70+) to supervisor", ruleType: "score_threshold", criteria: { threshold: 70, ownerId: owner }, ordinal: 60 },
  { name: "Balanced workload across Citizen Service Centre", ruleType: "capacity", criteria: { roster: [owner] }, ordinal: 70 },
  { name: "Round-robin general enquiries", ruleType: "round_robin", criteria: { roster: [owner], currentIndex: 0 }, ordinal: 80 },
].map((r) => ({ ...r, enabled: true })), "assignment-rules");

await ensure("escalation-rules", "escalation-rules", (x) => x.name, [
  { name: "Unaccepted lead - 4 hours", trigger: "unaccepted", thresholdMinutes: 240, recipientRole: "tenant_admin" },
  { name: "Unaccepted lead - 24 hours, reassign", trigger: "unaccepted", thresholdMinutes: 1440, recipientRole: "super_admin", reassign: true, reassignOwnerId: owner },
  { name: "Unattended lead - 2 working days", trigger: "unattended", thresholdMinutes: 2880, recipientRole: "tenant_admin" },
  { name: "Unattended lead - 7 days to Commissioner's office", trigger: "unattended", thresholdMinutes: 10080, recipientRole: "super_admin" },
].map((r) => ({ ...r, enabled: true })), "escalation-rules");
// the list endpoint exposes name only for some shapes; fall back handled by 409/skip above

await ensure("task-escalation-rules", "task-escalation-rules", (x) => x.name, [
  { name: "Overdue follow-up task - 1 day", appliesTo: "task", thresholdMinutes: 1440, recipientRole: "tenant_admin" },
  { name: "Missed next action - 8 hours", appliesTo: "next_action", thresholdMinutes: 480, recipientRole: "tenant_admin" },
  { name: "Statutory deadline at risk - 3 days", appliesTo: "both", thresholdMinutes: 4320, recipientRole: "super_admin" },
].map((r) => ({ ...r, enabled: true })), "task-escalation-rules");

// ---------- qualification frameworks ----------
const q = (prompt, answerType, weight, order, outcomeRule = {}) => ({ prompt, answerType, weight, order, outcomeRule });
await ensure("qualification-frameworks", "qualification-frameworks", (x) => x.name, [
  { name: "Service Request Eligibility Check", businessLine: "Citizen Services", active: true, questions: [
    q("Is the applicant a resident of a ward within municipal limits?", "bool", 30, 0), q("Are valid identity and address proofs available?", "bool", 30, 1),
    q("Are there any pending property tax or water dues on the premises?", "bool", 20, 2), q("Preferred mode of service delivery", "select", 20, 3, { options: ["Online", "Citizen Service Centre", "Ward Office"] }) ] },
  { name: "Trade Licence Readiness Assessment", businessLine: "Licensing", active: true, questions: [
    q("Does the premises have a valid ownership or rent agreement?", "bool", 25, 0), q("Is a fire safety NOC required for this trade?", "bool", 20, 1),
    q("Number of employees at the establishment", "number", 15, 2), q("Is FSSAI registration applicable?", "bool", 20, 3), q("Previous licence on record?", "bool", 20, 4) ] },
  { name: "Building Plan Pre-Scrutiny", businessLine: "Building Permissions", active: true, questions: [
    q("Is the plot title clear and registered?", "bool", 30, 0), q("Plot area (square metres)", "number", 20, 1), q("Is the land use conforming to the master plan?", "bool", 30, 2), q("Architect empanelled with the Corporation?", "bool", 20, 3) ] },
], "qualification-frameworks");

// ---------- stage limits (opportunity ageing) ----------
if (!DRY) {
  await sleep(2500);
  const pipes = await list("pipelines?limit=200");
  const byName = Object.fromEntries(pipes.map((p) => [p.name, p]));
  const limits = [
    ["Citizen Grievance Resolution", "Received", 2], ["Citizen Grievance Resolution", "Assigned", 3], ["Citizen Grievance Resolution", "In Progress", 15],
    ["Trade Licence Renewal", "Application Received", 5], ["Trade Licence Renewal", "Document Verification", 7], ["Trade Licence Renewal", "Inspection", 10], ["Trade Licence Renewal", "Fee Payment", 15],
    ["Property Tax Reassessment", "Field Survey", 20], ["Property Tax Reassessment", "Valuation Review", 15],
  ];
  const have = new Set((await list("stage-limits")).map((s) => `${s.pipelineId}:${s.stage}`));
  for (const [pn, st, maxDays] of limits) {
    const p = byName[pn]; const key = `${pn}/${st}`;
    if (!p) { tally("stage-limits", "failed"); console.log(`[FAILED]  stage-limits: ${key} (pipeline not visible yet)`); continue; }
    if (have.has(`${p.id}:${st}`)) { tally("stage-limits", "skipped"); console.log(`[skip]    stage-limits: ${key}`); continue; }
    const r = await api("PUT", "stage-limits", { pipelineId: p.id, stage: st, maxDays, enabled: true });
    if (r.status === 202 || r.status === 200) { tally("stage-limits", "created"); console.log(`[created] stage-limits: ${key} (${r.status})`); }
    else { tally("stage-limits", "failed"); console.log(`[FAILED]  stage-limits: ${key} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
  }
}

// ---------- lead scoring & dedup (PUT whole-set endpoints: only seeded when the tenant has none) ----------
const scoreRules = await list("lead-score-rules");
if (scoreRules.length > 0) { tally("lead-score-rules", "skipped"); console.log(`[skip]    lead-score-rules: tenant already has ${scoreRules.length}`); }
else if (!DRY) {
  const rules = [
    { attribute: "email", weight: 15, scoreFnType: "presence", params: { present: 80, absent: 10 } },
    { attribute: "phone", weight: 15, scoreFnType: "presence", params: { present: 80, absent: 10 } },
    { attribute: "leadSource", weight: 25, scoreFnType: "map", params: { values: { "citizen helpline": 80, "web portal": 70, "ward office": 90, "walk-in": 85 }, default: 40 } },
    { attribute: "lastActivityAt", weight: 25, scoreFnType: "recency", params: { tiers: [{ maxDays: 7, score: 100 }, { maxDays: 30, score: 60 }], beyondScore: 20, absentScore: 0 } },
    { attribute: "city", weight: 20, scoreFnType: "map", params: { values: { "civitas nagar": 100 }, default: 30 } },
  ].map((r) => ({ ...r, enabled: true }));
  const r = await api("PUT", "lead-score-rules", { rules });
  if ([200, 202].includes(r.status)) { tally("lead-score-rules", "created"); console.log(`[created] lead-score-rules: ${rules.length} (${r.status})`); }
  else { tally("lead-score-rules", "failed"); console.log(`[FAILED]  lead-score-rules -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
}
const dd = await list("dedup-rules");
if (dd.length > 0) { tally("dedup-rules", "skipped"); console.log(`[skip]    dedup-rules: tenant already has ${dd.length}`); }
else if (!DRY) {
  const rules = [["email", "exact", 40, 100], ["phone", "exact", 30, 100], ["pan", "exact", 40, 100], ["gstin", "exact", 50, 100], ["name", "fuzzy", 20, 80], ["company", "fuzzy", 15, 80]]
    .map(([field, matchType, weight, threshold]) => ({ field, matchType, weight, threshold, enabled: true }));
  const r = await api("PUT", "dedup-rules", { rules });
  if ([200, 202].includes(r.status)) { tally("dedup-rules", "created"); console.log(`[created] dedup-rules: ${rules.length} (${r.status})`); }
  else { tally("dedup-rules", "failed"); console.log(`[FAILED]  dedup-rules -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); }
}

console.log("\nSUMMARY " + JSON.stringify(stats, null, 1));
process.exit(Object.values(stats).some((s) => s.failed) ? 1 : 0);
