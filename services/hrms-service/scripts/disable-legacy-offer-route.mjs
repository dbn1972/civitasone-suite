#!/usr/bin/env node
/**
 * UAT F85 -- turn the deprecated legacy offer route OFF for every tenant.
 *
 * The legacy PATCH /v1/hrms/applications/:id/offer shortcut is enabled for a
 * tenant only when recruitment.hrms_recruitment_settings.offer_workflow_required
 * is explicitly false. A tenant with no settings row already has it off (the
 * column default and settings-repo.ts DEFAULT_SETTINGS are both `true`). This
 * script sets offer_workflow_required = true on every row where it is false.
 *
 * Idempotent: a second run finds nothing to change. Read-only unless --apply.
 * TODO(F85-go-live): delete with the legacy route.
 *
 *   DATABASE_URL=<hrms db, a role that bypasses RLS (the table is FORCE RLS)> \
 *     node services/hrms-service/scripts/disable-legacy-offer-route.mjs --dry-run
 *   ... --apply
 *
 * It refuses to run as a role that does not bypass RLS: such a role would see
 * no rows and wrongly report "nothing to change".
 */
import postgres from "postgres";

function parseArgs(argv) {
  const args = { apply: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.apply = false;
    else if (a === "--apply") args.apply = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: disable-legacy-offer-route.mjs --dry-run|--apply   (env: DATABASE_URL)");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const sql = postgres(url, { max: 1 });
  try {
    const [role] = await sql`select current_user as name, (rolsuper or rolbypassrls) as bypass from pg_roles where rolname = current_user`;
    if (!role?.bypass) {
      console.error(`role ${role?.name ?? "?"} does not bypass RLS; it cannot see every tenant's settings. Use the DB admin role.`);
      process.exitCode = 3;
      return;
    }
    const enabled = await sql`
      select tenant_id, updated_by, updated_at from recruitment.hrms_recruitment_settings
      where offer_workflow_required = false order by tenant_id`;
    console.log(`${enabled.length} tenant(s) have the legacy offer route enabled${enabled.length ? ":" : "."}`);
    for (const r of enabled) console.log(`  ${r.tenant_id} (last set by ${r.updated_by} at ${new Date(r.updated_at).toISOString()})`);
    if (!args.apply) {
      console.log("dry run: nothing changed. Re-run with --apply to turn it off for these tenants.");
      return;
    }
    const changed = await sql`
      update recruitment.hrms_recruitment_settings
      set offer_workflow_required = true, updated_at = now()
      where offer_workflow_required = false
      returning tenant_id`;
    console.log(`applied: legacy offer route turned off for ${changed.length} tenant(s).`);
    for (const r of changed) console.log(`  ${r.tenant_id}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
