#!/usr/bin/env node
/**
 * provision-uat-tenants.mjs — create N fresh offices for a usability test, so
 * each participant starts from a clean setup state.
 *
 * Usage (UAT only, fleet in dev-login/HS256 mode):
 *   node scripts/dev/provision-uat-tenants.mjs [count]
 *
 * It mints a super_admin dev token, creates `count` tenants via the gateway
 * (POST /api/v1/tenants), and prints a participant recipe: each participant
 * signs in at /auth/dev as `superadmin / Civitas@123` and enters their Office ID.
 *
 * Env:
 *   GATEWAY (default http://localhost:8080)
 *   JWT_SECRET (default civitasone-dev-secret — must match the fleet)
 */
import { createHmac } from "node:crypto";

const GATEWAY = process.env.GATEWAY || "http://localhost:8080";
const SECRET = process.env.JWT_SECRET || "civitasone-dev-secret";
const COUNT = Math.max(1, Math.min(20, Number(process.argv[2] || 5)));

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function mintSuperAdmin() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: "00000000-0000-0000-0000-000000000099", iss: "civitasone-dev",
    tid: "00000000-0000-0000-0000-000000000001", sid: "provision",
    roles: ["super_admin", "platform_admin", "admin"],
    iat: now, exp: now + 1800,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const slug = () => Math.random().toString(36).slice(2, 8);

async function createTenant(token, i) {
  const s = slug();
  const body = {
    name: `UAT Office ${i} (${s})`,
    domain: `uat-${i}-${s}.civitasone.in`,
    edition: "govt",
    region: "ap-south-1",
    residency: "in",
  };
  const res = await fetch(`${GATEWAY}/api/v1/tenants`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create tenant ${i} failed: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { participant: `P${i}`, officeId: json.id, name: body.name };
}

async function main() {
  const token = mintSuperAdmin();
  const results = [];
  for (let i = 1; i <= COUNT; i++) results.push(await createTenant(token, i));

  console.log(`\nProvisioned ${results.length} fresh offices for usability testing.\n`);
  console.log("Each participant signs in at  /auth/dev  as  superadmin / Civitas@123");
  console.log("and enters their Office ID in the optional field.\n");
  console.log("─".repeat(72));
  for (const r of results) {
    console.log(`${r.participant}  ${r.name}`);
    console.log(`     Office ID: ${r.officeId}`);
  }
  console.log("─".repeat(72));
  console.log("\nModerator: use a fresh browser profile/incognito per participant so the");
  console.log("first-run tour shows each time. Activation funnel: /tenant-admin/activation.\n");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
