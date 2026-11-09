#!/usr/bin/env node
/**
 * Idempotent backfill: give every existing tenant-namespaced realm user (`<tenantId>__<email>`,
 * created by identity-service) the `tenantId` and `tid` attributes, derived from its username.
 *
 * Run AFTER apply-user-profile.mjs --apply (otherwise Keycloak drops the attributes again; this
 * script re-reads each user after the write and reports `dropped` if so).
 * Users whose attributes already name a different tenant than their username are left alone
 * and reported as conflicts. Non-namespaced users (dev/admin logins) are skipped.
 *
 *   node infra/keycloak/scripts/backfill-tenant-attribute.mjs           # dry run
 *   node infra/keycloak/scripts/backfill-tenant-attribute.mjs --apply
 *
 * Then, per tenant, record the identity <-> Keycloak mapping:
 *   (identity-service) pnpm tsx src/scripts/backfill-keycloak-user-ids.ts --tenant <tenantId> --apply
 * Env: as apply-user-profile.mjs.
 */
import { readEnv, adminToken, planUser, withTenantAttributes, maskUsername } from "./lib.mjs";

const apply = process.argv.includes("--apply");
const cfg = readEnv();
const token = await adminToken(cfg);
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const base = `${cfg.url}/admin/realms/${cfg.realm}/users`;

const tally = { ok: 0, skip: 0, update: 0, updated: 0, conflict: [], dropped: [], failed: [] };
const PAGE = 100;
for (let first = 0; ; first += PAGE) {
  const res = await fetch(`${base}?first=${first}&max=${PAGE}&briefRepresentation=false`, { headers });
  if (!res.ok) throw new Error(`list users failed: ${res.status}`);
  const page = await res.json();
  for (const u of page) {
    const plan = planUser(u);
    if (plan.action === "ok" || plan.action === "skip") { tally[plan.action]++; continue; }
    if (plan.action === "conflict") { tally.conflict.push(maskUsername(u.username)); continue; }
    tally.update++;
    if (!apply) continue;
    const put = await fetch(`${base}/${u.id}`, { method: "PUT", headers, body: JSON.stringify(withTenantAttributes(u, plan.tenant)) });
    if (!put.ok) { tally.failed.push(`${maskUsername(u.username)}: ${put.status}`); continue; }
    const back = await (await fetch(`${base}/${u.id}`, { headers })).json();
    if ((back.attributes?.tenantId ?? []).includes(plan.tenant)) tally.updated++;
    else tally.dropped.push(maskUsername(u.username));
  }
  if (page.length < PAGE) break;
}
// Counts plus masked emails only: the namespaced usernames embed the tenant id and the full email.
console.log(JSON.stringify({ apply, ok: tally.ok, skip: tally.skip, toUpdate: tally.update, updated: tally.updated,
  conflict: tally.conflict.length, conflictUsers: tally.conflict,
  dropped: tally.dropped.length, droppedUsers: tally.dropped,
  failed: tally.failed.length, failedUsers: tally.failed }, null, 2));
if (tally.dropped.length > 0) {
  console.error("Keycloak dropped the attribute: the user profile does not declare it. Run apply-user-profile.mjs --apply first.");
  process.exit(2);
}
process.exit(tally.failed.length > 0 ? 1 : 0);
