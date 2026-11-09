#!/usr/bin/env node
/**
 * Idempotently declare the CivitasOne tenant attributes in the realm's Keycloak user profile.
 *
 * Why: Keycloak 24 drops attributes the user profile does not declare, so identity-service's
 * `tid` / `identity_user_id` / `email_addr` never reached the realm user and keycloak-reconcile
 * answered tid_missing forever. Only missing attributes are added; everything else in the
 * profile is left as it is. Safe to re-run.
 *
 *   node infra/keycloak/scripts/apply-user-profile.mjs            # dry run: prints what would change
 *   node infra/keycloak/scripts/apply-user-profile.mjs --apply    # PUT the merged profile
 *
 * Env: KEYCLOAK_ADMIN_URL (or KEYCLOAK_URL), KEYCLOAK_ADMIN_USER, KEYCLOAK_ADMIN_PASSWORD,
 *      optional KEYCLOAK_REALM (default civitasone).
 */
import { readEnv, adminToken, mergeProfile } from "./lib.mjs";

const apply = process.argv.includes("--apply");
const cfg = readEnv();
const token = await adminToken(cfg);
const endpoint = `${cfg.url}/admin/realms/${cfg.realm}/users/profile`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const cur = await fetch(endpoint, { headers });
if (!cur.ok) throw new Error(`GET user profile failed: ${cur.status}`);
const { profile, added } = mergeProfile(await cur.json());

if (added.length === 0) {
  console.log("user profile already declares all tenant attributes; nothing to do");
  process.exit(0);
}
console.log(`${apply ? "adding" : "would add"} to ${cfg.realm} user profile: ${added.join(", ")}`);
if (!apply) process.exit(0);

const put = await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify(profile) });
if (!put.ok) throw new Error(`PUT user profile failed: ${put.status} ${await put.text()}`);
console.log("done");
