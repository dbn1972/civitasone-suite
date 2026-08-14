#!/usr/bin/env node
// Sprint 3 — Comprehensive data seeding script
// Uses Node 20 built-in fetch. Run: node seed-sprint3.mjs

import { createHmac } from "node:crypto";

const HRMS    = "http://127.0.0.1:3012";
const PAYROLL = "http://127.0.0.1:3013";
const SECRET  = "civitasone-dev-secret";

// ── Minimal HS256 JWT mint (no external deps) ────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}
function mintJwt(payload) {
  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body    = b64url(JSON.stringify(payload));
  const signing = `${header}.${body}`;
  const sig     = createHmac("sha256", SECRET).update(signing).digest();
  return `${signing}.${b64url(sig)}`;
}

const TOKEN = mintJwt({
  sub: "00000000-0000-0000-0000-000000000099",   // must be a UUID (used as actorId in DB)
  tid: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000001",
  roles: ["super_admin","hr_admin","payroll_admin","hr_staff","audit_admin",
          "finance_admin","tenant_admin","dept_head","platform_admin"],
  iss: "civitasone-dev",
  aud: "civitasone",
  exp: Math.floor(Date.now() / 1000) + 157_680_000,
});

const HDR = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const ok  = (m)    => console.log("  ✓", m);
const err = (m)    => console.error("  ✗", m);

async function get(base, path) {
  const r = await fetch(`${base}${path}`, { headers: HDR });
  if (!r.ok) {
    err(`GET ${base}${path} → ${r.status}: ${await r.text()}`);
    return null;
  }
  return r.json();
}

async function post(base, path, body) {
  const r = await fetch(`${base}${path}`, {
    method: "POST", headers: HDR, body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) {
    err(`POST ${base}${path} → ${r.status}: ${text.slice(0, 200)}`);
    return null;
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. PAY STRUCTURES
// ─────────────────────────────────────────────────────────────────────────────
async function seedPayStructures() {
  log("=== STEP 1: Pay Structures ===");

  const existing = await get(PAYROLL, "/v1/payroll/structures") ?? [];
  log(`Existing structures: ${existing.length}`);

  const structures = [
    {
      name: "Grade A Pay Structure",
      description: "Basic ₹80,000 | DA 40% | HRA 27% | TA ₹3,200 — Senior Officer (IAS/IPS equivalent)",
      isDefault: false,
    },
    {
      name: "Grade B Pay Structure",
      description: "Basic ₹50,000 | DA 40% | HRA 24% | TA ₹2,400 — Middle Officer (Group B Gazetted)",
      isDefault: false,
    },
    {
      name: "Grade C Pay Structure",
      description: "Basic ₹30,000 | DA 40% | HRA 20% | TA ₹1,800 — Junior Staff (Group C)",
      isDefault: false,
    },
  ];

  const createdIds = {};
  for (const s of structures) {
    const exists = existing.find(x => x.name === s.name);
    if (exists) {
      ok(`Structure '${s.name}' already exists: ${exists.id}`);
      createdIds[s.name] = exists.id;
    } else {
      const resp = await post(PAYROLL, "/v1/payroll/structures", s);
      if (resp?.id) {
        ok(`Created '${s.name}': ${resp.id}`);
        createdIds[s.name] = resp.id;
      }
    }
  }

  // Wait for worker to persist
  await sleep(5000);

  // Re-fetch to get committed IDs
  const after = await get(PAYROLL, "/v1/payroll/structures") ?? [];
  log(`Structures after seeding: ${after.length}`);

  // Return the first available Grade A (or any committed) ID for the run
  const gradeA = after.find(x => x.name?.includes("Grade A"));
  const runStructId = gradeA?.id ?? after[0]?.id ?? "ffffffff-0000-0000-0000-000000000001";
  return { count: after.length, runStructId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PAYROLL RUN — July 2026
// ─────────────────────────────────────────────────────────────────────────────
async function seedPayrollRun(structureId) {
  log("=== STEP 2: Payroll Run — July 2026 ===");

  const existing = await get(PAYROLL, "/v1/payroll/runs") ?? { data: [] };
  const runs = existing?.data ?? existing ?? [];
  const julRun = runs.find(r => r.payPeriod === "2026-07" || r.month === "2026-07");

  if (julRun) {
    ok(`July 2026 run already exists: ${julRun.id}`);
    return julRun.id;
  }

  const resp = await post(PAYROLL, "/v1/payroll/runs", {
    runNo:       "RUN-2026-07-001",
    month:       "2026-07",
    structureId: structureId,
    runType:     "regular",
  });

  if (resp?.id) {
    ok(`Created July 2026 payroll run: ${resp.id}`);
    return resp.id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TRAINING PROGRAMS
// ─────────────────────────────────────────────────────────────────────────────
async function seedTrainingPrograms() {
  log("=== STEP 3: Training Programs ===");

  const existing = await get(HRMS, "/v1/hrms/training-programs?limit=50") ?? { data: [] };
  const trainings = existing?.data ?? [];
  log(`Existing training programs: ${trainings.length}`);

  const programs = [
    {
      title: "Leadership & Governance",
      venue: "LBSNAA, Mussoorie",
      fromDate: "2026-09-01", toDate: "2026-09-05",
      facilitator: "LBSNAA Faculty",
      maxParticipants: 40,
    },
    {
      title: "Digital Literacy for Government Officials",
      venue: "NICSI, New Delhi",
      fromDate: "2026-09-10", toDate: "2026-09-12",
      facilitator: "NICSI Training Division",
      maxParticipants: 50,
    },
    {
      title: "RTI Act Compliance Training",
      venue: "ISTM, New Delhi",
      fromDate: "2026-10-01", toDate: "2026-10-03",
      facilitator: "Central Information Commission",
      maxParticipants: 60,
    },
    {
      title: "DPDP Act Awareness Programme",
      venue: "Ministry of Electronics & IT, New Delhi",
      fromDate: "2026-10-15", toDate: "2026-10-16",
      facilitator: "MeitY Training Cell",
      maxParticipants: 80,
    },
    {
      title: "Anti-Corruption Policy & Ethics",
      venue: "CVC, New Delhi",
      fromDate: "2026-11-01", toDate: "2026-11-03",
      facilitator: "Central Vigilance Commission",
      maxParticipants: 45,
    },
  ];

  const created = [];
  for (const p of programs) {
    const exists = trainings.find(t => t.title === p.title);
    if (exists) {
      ok(`Training '${p.title}' already exists: ${exists.id}`);
      created.push(exists.id);
    } else {
      const resp = await post(HRMS, "/v1/hrms/trainings", p);
      if (resp?.id) {
        ok(`Created training '${p.title}': ${resp.id}`);
        created.push(resp.id);
      }
      await sleep(500);
    }
  }

  await sleep(3000);
  const after = await get(HRMS, "/v1/hrms/training-programs?limit=50") ?? { data: [] };
  log(`Training programs after seeding: ${(after?.data ?? []).length}`);
  return (after?.data ?? []).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. APPRAISAL CYCLES
// ─────────────────────────────────────────────────────────────────────────────
async function seedAppraisals() {
  log("=== STEP 4: Appraisal Cycles ===");

  const existing = await get(HRMS, "/v1/hrms/appraisals?limit=100") ?? { data: [] };
  const appraisals = existing?.data ?? [];
  log(`Existing appraisals: ${appraisals.length}`);

  // Representative employees for each cycle
  const employees = [
    "a549f454-0378-4144-b1bc-9ea5ef820034",  // Rajesh Kumar Singh
    "ff17e68a-4266-4f2b-8415-5489a14fc2f0",  // Myra Reddy
    "ac48127b-0119-487d-afe1-3e1e5da69090",  // Arjun Iyer
    "316c6016-b538-4513-91cb-5591f5f88ce0",  // Meena Gupta
    "ae6dd372-2800-42c5-bbc5-004f5ba7b6e7",  // Swati Sharma
  ];

  const periods = ["FY2024-25", "FY2025-26", "FY2026-27"];
  let created = 0;

  for (const period of periods) {
    for (const empId of employees) {
      const exists = appraisals.find(
        a => a.appraisalPeriod === period && a.employeeId === empId
      );
      if (exists) {
        ok(`Appraisal ${period}/${empId.slice(0,8)} already exists`);
      } else {
        const resp = await post(HRMS, "/v1/hrms/appraisals", {
          employeeId: empId,
          appraisalPeriod: period,
        });
        if (resp?.id) {
          ok(`Created appraisal ${period} for ${empId.slice(0,8)}: ${resp.id}`);
          created++;
        }
        await sleep(300);
      }
    }
  }

  await sleep(3000);
  const after = await get(HRMS, "/v1/hrms/appraisals?limit=100") ?? { data: [] };
  log(`Appraisals after seeding: ${(after?.data ?? []).length} (created ${created} new)`);
  return (after?.data ?? []).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TRANSFER ORDERS
// ─────────────────────────────────────────────────────────────────────────────
async function seedTransfers() {
  log("=== STEP 5: Transfer Orders ===");

  const existing = await get(HRMS, "/v1/hrms/lifecycle/transfers") ?? { data: [] };
  const transfers = existing?.data ?? [];
  log(`Existing transfers: ${transfers.length}`);

  // Department IDs from the live system
  const DEPTS = {
    HR:   "78d1c3e0-9442-4651-b9cc-bea796ac71fa",
    FIN:  "30b87697-503a-45fb-b552-79560bbfabf8",
    IT:   "2a0d89d6-20d2-4d0d-a6e1-2336d6d03bfd",
    ADM:  "278f880c-d5f4-4291-b2c5-70b8de3256e7",
    ENG:  "f14c41fc-5ecb-487a-9167-86f5aad3c5cb",
    LEG:  "67d030d2-3516-4d27-9bc1-d95da51125fe",
    PROC: "138ab133-c4d2-4ec4-95df-bb8eee72cbc9",
    PLAN: "7947036d-9999-47a5-b532-cd44db27214d",
    ESTB: "be112607-5f41-4d7d-91c4-d6672c7ce72f",
  };

  const transferOrders = [
    { empId: "34dc5246-e9fd-4ad2-8584-43038203a724", from: DEPTS.HR,   to: DEPTS.ADM,  eff: "2026-08-01", order: "TO/2026-27/001" },
    { empId: "454972ae-4338-40f6-bf6a-34c39dfe0154", from: DEPTS.ADM,  to: DEPTS.FIN,  eff: "2026-08-01", order: "TO/2026-27/002" },
    { empId: "316c6016-b538-4513-91cb-5591f5f88ce0", from: DEPTS.FIN,  to: DEPTS.IT,   eff: "2026-08-02", order: "TO/2026-27/003" },
    { empId: "ae6dd372-2800-42c5-bbc5-004f5ba7b6e7", from: DEPTS.IT,   to: DEPTS.ENG,  eff: "2026-08-02", order: "TO/2026-27/004" },
    { empId: "a680540b-393b-4427-8afd-017f4ae67918", from: DEPTS.ENG,  to: DEPTS.LEG,  eff: "2026-08-03", order: "TO/2026-27/005" },
    { empId: "e558761a-a3b4-4f36-b819-bd452f9c6b53", from: DEPTS.LEG,  to: DEPTS.HR,   eff: "2026-08-03", order: "TO/2026-27/006" },
    { empId: "90916cff-4189-4bc0-9f34-93d55690e607", from: DEPTS.HR,   to: DEPTS.PROC, eff: "2026-08-05", order: "TO/2026-27/007" },
    { empId: "3415a95e-34b0-4351-88b8-6a7182df14b3", from: DEPTS.ADM,  to: DEPTS.PLAN, eff: "2026-08-05", order: "TO/2026-27/008" },
    { empId: "3fd80963-caa5-4586-8030-9eff3f96cd6c", from: DEPTS.FIN,  to: DEPTS.ESTB, eff: "2026-08-06", order: "TO/2026-27/009" },
    { empId: "093a21bb-9b83-4ad8-afa6-173147f4d292", from: DEPTS.IT,   to: DEPTS.ADM,  eff: "2026-08-06", order: "TO/2026-27/010" },
  ];

  let created = 0;
  for (const tx of transferOrders) {
    const exists = transfers.find(t => t.employeeId === tx.empId);
    if (exists) {
      ok(`Transfer for ${tx.empId.slice(0,8)} already exists`);
    } else {
      const resp = await post(HRMS, "/v1/hrms/lifecycle/transfers", {
        employeeId:    tx.empId,
        fromDeptId:    tx.from,
        toDeptId:      tx.to,
        effectiveDate: tx.eff,
        orderRef:      tx.order,
        fromStation:   "Head Office",
        toStation:     "Field Office",
      });
      if (resp?.id) {
        ok(`Created transfer ${tx.order} for ${tx.empId.slice(0,8)}: ${resp.id}`);
        created++;
      }
      await sleep(400);
    }
  }

  await sleep(3000);
  const after = await get(HRMS, "/v1/hrms/lifecycle/transfers") ?? { data: [] };
  log(`Transfers after seeding: ${(after?.data ?? []).length} (created ${created} new)`);
  return (after?.data ?? []).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. PROMOTIONS
// ─────────────────────────────────────────────────────────────────────────────
async function seedPromotions() {
  log("=== STEP 6: Promotions ===");

  const existing = await get(HRMS, "/v1/hrms/lifecycle/promotions") ?? { data: [] };
  const promotions = existing?.data ?? [];
  log(`Existing promotions: ${promotions.length}`);

  // Designation IDs from the live system
  const DESIG = {
    HRO:     "87b75dec-264e-4544-86ad-ab91226b3854",  // HR Officer level 4
    JE:      "7e4bf100-56a3-4f67-bcf6-9cb1934810c9",  // Junior Engineer level 5
    HRM:     "d8da15ec-0cbc-4322-a22a-91e4f06b457e",  // HR Manager level 6
    HRD:     "687027a0-56f0-4918-a45d-15f92c0f486f",  // HR Director level 8
    ADDLSEC: "61e4593a-05e6-4c80-ab21-2dfb621e858f",  // Additional Secretary level 15
  };

  const promoOrders = [
    { empId: "f25fd715-8738-4ace-84d5-bcac4dd8ca4b", from: DESIG.HRO, to: DESIG.HRM, eff: "2026-07-01", order: "PROMO/2026-27/001", newBasicMinor: 5000000 },
    { empId: "a04c1df6-15c4-496c-9db8-44399cf3c95c", from: DESIG.HRM, to: DESIG.HRD, eff: "2026-07-01", order: "PROMO/2026-27/002", newBasicMinor: 8000000 },
    { empId: "0f1f25ee-6104-4011-bec9-38162615044e", from: DESIG.HRO, to: DESIG.HRM, eff: "2026-07-15", order: "PROMO/2026-27/003", newBasicMinor: 5200000 },
    { empId: "77831cd1-ba88-4c34-9e06-f2079289494e", from: DESIG.JE,  to: DESIG.HRO, eff: "2026-07-15", order: "PROMO/2026-27/004", newBasicMinor: 4400000 },
    { empId: "7d0747fe-efaf-4eef-a312-50f04e650cd7", from: DESIG.HRM, to: DESIG.HRD, eff: "2026-08-01", order: "PROMO/2026-27/005", newBasicMinor: 8200000 },
  ];

  let created = 0;
  for (const p of promoOrders) {
    const exists = promotions.find(x => x.employeeId === p.empId);
    if (exists) {
      ok(`Promotion for ${p.empId.slice(0,8)} already exists`);
    } else {
      const resp = await post(HRMS, "/v1/hrms/lifecycle/promotions", {
        employeeId:    p.empId,
        fromDesigId:   p.from,
        toDesigId:     p.to,
        effectiveDate: p.eff,
        orderRef:      p.order,
        newBasicMinor: p.newBasicMinor,
      });
      if (resp?.id) {
        ok(`Created promotion ${p.order} for ${p.empId.slice(0,8)}: ${resp.id}`);
        created++;
      }
      await sleep(400);
    }
  }

  await sleep(3000);
  const after = await get(HRMS, "/v1/hrms/lifecycle/promotions") ?? { data: [] };
  log(`Promotions after seeding: ${(after?.data ?? []).length} (created ${created} new)`);
  return (after?.data ?? []).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  log("Starting Sprint 3 data seeding...");

  const { count: structCount, runStructId } = await seedPayStructures();
  const runId      = await seedPayrollRun(runStructId);
  const trainCount = await seedTrainingPrograms();
  const aprCount   = await seedAppraisals();
  const txCount    = await seedTransfers();
  const promoCount = await seedPromotions();

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   SPRINT 3 SEED — FINAL VERIFICATION    ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Pay Structures   : ${String(structCount).padEnd(20)} ║`);
  console.log(`║  Payroll Run ID   : ${(runId ?? "none").slice(0,20).padEnd(20)} ║`);
  console.log(`║  Training Programs: ${String(trainCount).padEnd(20)} ║`);
  console.log(`║  Appraisals       : ${String(aprCount).padEnd(20)} ║`);
  console.log(`║  Transfers        : ${String(txCount).padEnd(20)} ║`);
  console.log(`║  Promotions       : ${String(promoCount).padEnd(20)} ║`);
  console.log("╚══════════════════════════════════════════╝");

  return { structCount, runId, trainCount, aprCount, txCount, promoCount };
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
