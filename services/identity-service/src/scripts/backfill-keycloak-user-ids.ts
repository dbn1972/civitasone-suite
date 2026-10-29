/**
 * CLI for the one-off FQ14 backfill of users.users.keycloak_user_id (migration
 * 0033) for users created before the column existed. See
 * modules/users/keycloak-link.ts backfillKeycloakUserIds.
 *
 *   tsx src/scripts/backfill-keycloak-user-ids.ts --tenant <uuid>           # dry run
 *   tsx src/scripts/backfill-keycloak-user-ids.ts --tenant <uuid> --apply
 *
 * Needs the service's normal env (DATABASE_URL, KEYCLOAK_URL and Keycloak
 * admin creds). Reads Keycloak only; writes only keycloak_user_id. One tenant
 * per invocation. Prints a JSON report.
 * Exit codes: 0 ok, 1 error, 2 finished but some users need a human
 * (unmatched / tid missing / conflicting / lookup errors), 3 no users of this
 * tenant were visible at all (wrong tenant id, or an empty tenant): nothing
 * was checked, so this is never reported as success (FQ16).
 */
import { backfillKeycloakUserIds } from "../modules/users/keycloak-link.js";
import { sqlClient } from "../shared/db.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<number> {
  const tenantId = arg("--tenant");
  if (!tenantId || !UUID_RE.test(tenantId)) {
    process.stderr.write("usage: --tenant <uuid> [--apply]\n");
    return 1;
  }
  const report = await backfillKeycloakUserIds({ tenantId, apply: process.argv.includes("--apply") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.tenantUsers === 0) {
    // FQ16: an empty scan is not success. Nothing for this tenant was readable.
    process.stderr.write(`no users visible for tenant ${tenantId} (wrong tenant id, or the tenant has no users); nothing was checked\n`);
    return 3;
  }
  return report.unmatched.length + report.tidMissing.length + report.conflicts.length + report.errors.length > 0 ? 2 : 0;
}

main()
  .then(async (code) => { await sqlClient.end(); process.exit(code); })
  .catch(async (err: unknown) => {
    process.stderr.write(`backfill failed: ${err instanceof Error ? err.message : String(err)}\n`);
    await sqlClient.end();
    process.exit(1);
  });
