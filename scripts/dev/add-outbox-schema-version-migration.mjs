#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// add-outbox-schema-version-migration.mjs — PERF-008.
//
// Generates one new migration file per service — `_outbox.messages` gains a
// `schema_version` column (see packages/outbox/src/index.ts and
// packages/outbox/src/schema-versions.ts) — so relayOnce can publish the
// version actually stamped on each row at enqueue() time, instead of the
// single hardcoded "1.0" literal it used to pass to every publish() call
// regardless of topic.
//
// WHY FLEET-WIDE IN ONE PASS (not a representative slice + baseline-ratchet,
// unlike this gap's other two pieces): `outboxMessages` is ONE shared Drizzle
// table definition in packages/outbox/src/index.ts, imported by every
// service. The moment a service picks up the new package version, its
// relayOnce/enqueue() code expects the `schema_version` column to exist in
// THAT service's own database — there is no way to ship this column to only
// some services' code while leaving their databases unmigrated; every
// service must get the column, or its outbox relay/enqueue breaks the
// instant it deploys the new shared package. Unlike the messageId lint guard
// (an independent, file-by-file static check with no such coupling), this
// migration is genuinely all-or-nothing, and it happens to also be uniform,
// safe, and 100% mechanical (the same 1-line ALTER TABLE ... ADD COLUMN ...
// DEFAULT ... for every service), which is why doing all 65 here is the
// right call rather than a slice.
//
// Verified DYNAMICALLY, not assumed: this only writes a migration for a
// service whose OWN existing migrations actually create `_outbox.messages`
// (grepped from the real .sql files, not a hardcoded service list) — see
// this file's own `git log` / PR description for the live-Postgres
// introspection cross-check run alongside this (all 65 provisioned service
// databases confirmed to already have `_outbox.messages` before this ran).
//
// Idempotent: `ADD COLUMN IF NOT EXISTS ... DEFAULT '1.0'` never fails or
// double-applies if bootstrap-postgres.sh (or any other runner) re-applies
// this migration on top of a database that already has the column.
//
// Usage: node scripts/dev/add-outbox-schema-version-migration.mjs [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(ROOT, "services");
const DRY_RUN = process.argv.includes("--dry-run");

const MIGRATION_SQL = `-- PERF-008: schema_version column for _outbox.messages.
-- Additive, backward compatible: DEFAULT applies to existing unpublished
-- rows too, so relayOnce (packages/outbox/src/index.ts) can always read
-- row.schemaVersion instead of the old hardcoded "1.0" literal. Idempotent.
ALTER TABLE _outbox.messages ADD COLUMN IF NOT EXISTS schema_version varchar(16) NOT NULL DEFAULT '1.0';
`;

function nextMigrationNumber(files) {
  let max = 0;
  for (const f of files) {
    const m = f.match(/^(\d+)_/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  // This repo's own convention is inconsistent about zero-padding width once
  // a service passes 999 (hrms-service is at 0105, most are 2-3 digits) --
  // matching whatever width this SPECIFIC service already uses keeps `ls`
  // sort order correct, which is what actually matters (migrate-all.mjs and
  // bootstrap-postgres.sh both apply files in `readdirSync().sort()` order).
  const width = files.some((f) => /^\d{4}_/.test(f)) ? 4 : 3;
  return String(max + 1).padStart(width, "0");
}

function serviceHasOutboxMessages(migrationsDir, files) {
  for (const f of files) {
    const text = readFileSync(join(migrationsDir, f), "utf8");
    if (/_outbox\.messages/.test(text)) return true;
  }
  return false;
}

function main() {
  const services = readdirSync(SERVICES_DIR).filter((d) => {
    try { return statSync(join(SERVICES_DIR, d)).isDirectory(); } catch { return false; }
  });

  let written = 0;
  let skippedNoOutbox = 0;
  let skippedNoMigrations = 0;

  for (const svc of services) {
    const migrationsDir = join(SERVICES_DIR, svc, "migrations");
    if (!existsSync(migrationsDir)) { skippedNoMigrations++; continue; }
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    if (files.length === 0) { skippedNoMigrations++; continue; }

    if (!serviceHasOutboxMessages(migrationsDir, files)) {
      console.log(`[skip] ${svc}: no _outbox.messages in its migrations`);
      skippedNoOutbox++;
      continue;
    }

    const num = nextMigrationNumber(files);
    const filename = `${num}_perf008_outbox_schema_version.sql`;
    const filePath = join(migrationsDir, filename);
    if (existsSync(filePath)) {
      console.log(`[skip] ${svc}: ${filename} already exists`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`[dry-run] would write ${svc}/${filename}`);
    } else {
      writeFileSync(filePath, MIGRATION_SQL);
      console.log(`[ok]   ${svc}/${filename}`);
    }
    written++;
  }

  console.log(`\n── Summary ──────────────────────────────`);
  console.log(`Written (or would write): ${written}`);
  console.log(`Skipped (no _outbox.messages found): ${skippedNoOutbox}`);
  console.log(`Skipped (no migrations dir/files): ${skippedNoMigrations}`);
}

main();
