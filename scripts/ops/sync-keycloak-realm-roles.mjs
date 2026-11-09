#!/usr/bin/env node
/**
 * UAT bundle 23: add the realm roles that service guards name but the live Keycloak realm lacks.
 *
 * Source of truth: realm.roles.realm in infra/keycloak/civitasone-realm.json (checked in, reconciled to the live realm).
 * CREATE-ONLY and idempotent:
 *   - lists the live realm roles, then POSTs only the roles that are in the JSON and absent live;
 *   - never PUTs, DELETEs or otherwise modifies an existing role, and never touches users, groups, composites or clients;
 *   - a second run finds nothing to create. A 409 from a concurrent create counts as "already exists".
 *
 * Usage:
 *   KEYCLOAK_ADMIN_USER=<admin user> KEYCLOAK_ADMIN_PASSWORD_FILE=<file holding the password> \
 *     node scripts/ops/sync-keycloak-realm-roles.mjs [--dry-run]
 * Env: KEYCLOAK_URL (default http://localhost:8180/auth), KEYCLOAK_REALM (default civitasone),
 *      KEYCLOAK_ADMIN_PASSWORD (alternative to the file), KEYCLOAK_ADMIN_CLIENT (default admin-cli).
 * The admin user needs the realm-management "manage-realm" role (roles are created in the realm, not the master realm).
 * Nothing secret is printed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REALM_FILE = join(HERE, "../../infra/keycloak/civitasone-realm.json");

/** Pure: which desired roles are not yet live. Existing live roles are never in the result, whatever their description. */
export function planRoleSync(desiredRoles, liveRoleNames) {
  const live = new Set(liveRoleNames);
  const seen = new Set();
  const create = [];
  for (const r of desiredRoles) {
    if (!r || typeof r.name !== "string" || r.name === "") continue;
    if (live.has(r.name) || seen.has(r.name)) continue;
    seen.add(r.name);
    create.push(r.description ? { name: r.name, description: r.description } : { name: r.name });
  }
  return create;
}

export function desiredRealmRoles(file = REALM_FILE) {
  return JSON.parse(readFileSync(file, "utf8")).roles.realm;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const base = (process.env.KEYCLOAK_URL ?? "http://localhost:8180/auth").replace(/\/$/, "");
  const realm = process.env.KEYCLOAK_REALM ?? "civitasone";
  const user = process.env.KEYCLOAK_ADMIN_USER;
  const pwFile = process.env.KEYCLOAK_ADMIN_PASSWORD_FILE;
  const pw = pwFile ? readFileSync(pwFile, "utf8").trim() : process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!user || !pw) throw new Error("set KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD_FILE (or KEYCLOAK_ADMIN_PASSWORD)");

  const tokRes = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: process.env.KEYCLOAK_ADMIN_CLIENT ?? "admin-cli", username: user, password: pw }),
  });
  if (!tokRes.ok) throw new Error(`admin token request failed: HTTP ${tokRes.status}`);
  const auth = { authorization: `Bearer ${(await tokRes.json()).access_token}` };

  const listRes = await fetch(`${base}/admin/realms/${realm}/roles?max=2000`, { headers: auth });
  if (!listRes.ok) throw new Error(`list roles failed: HTTP ${listRes.status}`);
  const live = (await listRes.json()).map((r) => r.name);
  const plan = planRoleSync(desiredRealmRoles(), live);
  console.log(`realm ${realm}: ${live.length} live roles, ${plan.length} to create${dry ? " (dry run, nothing written)" : ""}`);

  let created = 0, existed = 0, failed = 0;
  for (const role of plan) {
    if (dry) { console.log(`  would create ${role.name}`); continue; }
    const res = await fetch(`${base}/admin/realms/${realm}/roles`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(role),
    });
    if (res.status === 201) { created++; console.log(`  created ${role.name}`); }
    else if (res.status === 409) { existed++; console.log(`  exists  ${role.name}`); }
    else { failed++; console.log(`  FAILED  ${role.name}: HTTP ${res.status}`); }
  }
  if (!dry) console.log(`done: created ${created}, already existed ${existed}, failed ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
