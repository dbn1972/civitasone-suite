#!/usr/bin/env node
/**
 * provision-platform-roles.mjs — create the login roles for the seven
 * customer-engagement platform services and grant them access to their own
 * database.
 *
 * ─── DEV-ONLY CREDENTIALS ──────────────────────────────────────────────────
 * The passwords defaulted below are LOCAL DEVELOPMENT credentials for the
 * `civitasone-postgres` container on localhost:5435. They exist only so the
 * DSNs already hard-coded in each service's `vitest.config.ts` resolve against
 * a real Postgres on a developer machine.
 *
 * Production (and staging/UAT) service roles and their passwords are owned by
 * `infra/db/bootstrap/*` and sourced from the secret manager. These defaults
 * MUST NEVER be used outside local dev. Override any of them here with
 * `<SVC>_DB_PASSWORD` (e.g. `LOYALTY_DB_PASSWORD=… node scripts/dev/provision-platform-roles.mjs`).
 *
 * Why this script exists: the service migrations deliberately do NOT create
 * their login role (an earlier version ran `CREATE ROLE <svc> LOGIN` with no
 * password, which is a credential-free account). Their grant blocks are guarded
 * on `EXISTS (SELECT 1 FROM pg_roles …)`, so on a fresh local database the
 * grants are silently skipped and the services cannot connect at all. This
 * script closes that gap — idempotently, and always with a password.
 *
 * Usage: node scripts/dev/provision-platform-roles.mjs
 */
import { execSync } from "node:child_process";

const CONTAINER = process.env.PG_CONTAINER ?? "civitasone-postgres";
const SUPERUSER = process.env.PG_SUPERUSER ?? "civitas_admin";

/**
 * One entry per customer-engagement platform service.
 * `schema` is the service's own PG schema; every service additionally needs the
 * shared `_outbox` / `_inbox` schemas for the transactional outbox.
 */
const SERVICES = [
  { role: "cdp_svc",            db: "civitas_cdp",            schema: "cdp",            envKey: "CDP_DB_PASSWORD",            defaultPassword: "cdp_dev_pw" },
  { role: "catalogue_svc",      db: "civitas_catalogue",      schema: "catalogue",      envKey: "CATALOGUE_DB_PASSWORD",      defaultPassword: "catalogue_dev_pw" },
  { role: "journey_svc",        db: "civitas_journey",        schema: "journey",        envKey: "JOURNEY_DB_PASSWORD",        defaultPassword: "journey_dev_pw" },
  { role: "field_svc",          db: "civitas_field",          schema: "field",          envKey: "FIELD_DB_PASSWORD",          defaultPassword: "field_dev_pw" },
  { role: "loyalty_svc",        db: "civitas_loyalty",        schema: "loyalty",        envKey: "LOYALTY_DB_PASSWORD",        defaultPassword: "loyalty_dev_pw" },
  { role: "recommendation_svc", db: "civitas_recommendation", schema: "recommendation", envKey: "RECOMMENDATION_DB_PASSWORD", defaultPassword: "recommendation_dev_pw" },
  { role: "ai_agent_svc",       db: "civitas_ai_agent",       schema: "ai_agent",       envKey: "AI_AGENT_DB_PASSWORD",       defaultPassword: "ai_agent_dev_pw" },
];

const SHARED_SCHEMAS = ["_outbox", "_inbox"];
const TABLE_PRIVS = "SELECT, INSERT, UPDATE, DELETE";

/** Quote a value as a SQL string literal (doubling embedded single quotes). */
function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Run SQL on stdin against `db` as the superuser, aborting on the first error. */
function psql(db, sql) {
  return execSync(
    `docker exec -i ${CONTAINER} psql -U ${SUPERUSER} -d ${db} -v ON_ERROR_STOP=1 -X -q -At`,
    { input: sql, stdio: ["pipe", "pipe", "pipe"] },
  ).toString().trim();
}

/**
 * Create the role with a password if absent; if it already exists but is
 * passwordless (a leftover from the old `CREATE ROLE … LOGIN` migrations), set
 * a password. Never leaves a login role without one. Returns "created" |
 * "password-set" | "exists".
 */
function ensureRole({ role, envKey, defaultPassword }) {
  const password = process.env[envKey] ?? defaultPassword;
  const pw = quoteLiteral(password);
  const sql = `
DO $prov$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${role}', ${pw});
    RAISE NOTICE 'created';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_authid WHERE rolname = '${role}' AND rolpassword IS NOT NULL) THEN
    -- Guard the invariant: a LOGIN role must never be passwordless.
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', '${role}', ${pw});
    RAISE NOTICE 'password-set';
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN', '${role}');
    RAISE NOTICE 'exists';
  END IF;
END
$prov$;
`;
  // NOTICEs arrive on stderr; re-read the resulting state instead of parsing them.
  psql("postgres", sql);
  const state = psql(
    "postgres",
    `SELECT CASE WHEN rolcanlogin AND rolpassword IS NOT NULL THEN 'ok' ELSE 'incomplete' END
       FROM pg_authid WHERE rolname = '${role}';`,
  );
  if (state !== "ok") {
    throw new Error(`role ${role} is not a password-protected LOGIN role after provisioning`);
  }
}

/** Grant schema usage + table DML + matching default privileges, idempotently. */
function grantSchemas({ role, db, schema }) {
  const schemas = [schema, ...SHARED_SCHEMAS];
  const statements = [`GRANT CONNECT ON DATABASE ${db} TO ${role};`];
  for (const s of schemas) {
    statements.push(
      `GRANT USAGE ON SCHEMA ${s} TO ${role};`,
      `GRANT ${TABLE_PRIVS} ON ALL TABLES IN SCHEMA ${s} TO ${role};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${TABLE_PRIVS} ON TABLES TO ${role};`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${role};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${role};`,
    );
  }
  psql(db, `BEGIN;\n${statements.join("\n")}\nCOMMIT;\n`);
}

let ok = 0;
let errors = 0;

for (const svc of SERVICES) {
  try {
    ensureRole(svc);
    grantSchemas(svc);
    console.log(`[ok]   ${svc.role} → ${svc.db} (schemas: ${[svc.schema, ...SHARED_SCHEMAS].join(", ")})`);
    ok++;
  } catch (err) {
    const detail = ((err.stderr ?? "") + (err.stdout ?? "")).toString().trim() || String(err.message ?? err);
    console.error(`[ERR]  ${svc.role}: ${detail.slice(0, 400)}`);
    errors++;
  }
}

console.log(`\n── Platform role summary ──────────────`);
console.log(`Provisioned : ${ok}`);
console.log(`Errors      : ${errors}`);
if (errors > 0) process.exit(1);
