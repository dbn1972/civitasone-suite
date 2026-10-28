#!/usr/bin/env node
/**
 * check-fleet-dsns.mjs -- connect with every postgres DSN that ecosystem.config.js
 * injects in dev mode and report role@host/db ok|fail. Passwords are never
 * printed. Catches role-password drift (UAT DB test 2026-10-28: advertisement_svc,
 * animal_svc, vendor_svc and four *_scanner roles could not log in).
 *
 * Usage: node scripts/ops/check-fleet-dsns.mjs
 * Env:   CHECK_DSN_HOSTPORT=host:port  override the host:port in every DSN
 *                                      (e.g. to test a disposable Postgres
 *                                      instead of PgBouncer on :6432).
 * Exit:  0 all ok, 1 any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
process.env.NODE_ENV = "development"; // dev defaults, not the prod fail-closed path
const require = createRequire(join(ROOT, "packages/db/package.json"));
const postgres = require("postgres");
const eco = createRequire(import.meta.url)(join(ROOT, "ecosystem.config.js"));

const dsns = new Map();
for (const app of eco.apps ?? []) {
  for (const [k, v] of Object.entries(app.env ?? {})) {
    if (typeof v === "string" && /^postgres(ql)?:\/\//.test(v)) dsns.set(v, `${app.name}:${k}`);
  }
}

const override = process.env.CHECK_DSN_HOSTPORT;
let failed = 0;
for (const dsn of dsns.keys()) {
  const u = new URL(dsn);
  if (override) u.host = override;
  const label = `${decodeURIComponent(u.username)}@${u.host}${u.pathname}`;
  const sql = postgres(u.toString(), { max: 1, connect_timeout: 8, onnotice: () => {}, prepare: false });
  try {
    await sql`select 1`;
    console.log(`ok   ${label}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${label} (${e.code ?? e.message?.split("\n")[0]?.slice(0, 60)})`);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}
console.log(`${dsns.size - failed}/${dsns.size} DSNs ok`);
process.exit(failed ? 1 : 0);
