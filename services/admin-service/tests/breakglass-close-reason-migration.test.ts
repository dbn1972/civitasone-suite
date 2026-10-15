/**
 * GAP-TENANT-ADMIN-BREAKGLASS-06: migration 0052 must backfill close_reason for
 * grants closed BEFORE the column existed. The table is FORCE RLS and the
 * migration runs as the owner with no tenant GUC, so the backfill needs the
 * NO FORCE / FORCE wrap (same idiom as 0051). Runs the REAL migration.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const { sqlClient } = await import("../src/shared/db.js");

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000099";
const T1 = randomUUID();
const T2 = randomUUID();
const OPERATOR = randomUUID();
const SWEPT = randomUUID();
const MANUAL = randomUUID();
const TENANTS = [T1, T2];

function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}
async function insertClosed(id: string, tenantId: string, updatedBy: string) {
  await asTenant(tenantId, (sql) => sql`
    INSERT INTO support.admin_break_glass_log
      (id, tenant_id, ticket_id, actor_id, reason, expires_at, closed_at, close_reason,
       correlation_id, created_by, updated_by)
    VALUES (${id}, ${tenantId}, ${randomUUID()}, ${OPERATOR}, 'legacy grant',
            now() - interval '1 hour', now() - interval '30 minutes', NULL,
            ${randomUUID()}, ${OPERATOR}, ${updatedBy})`);
}
const reason = (id: string, t: string) =>
  asTenant(t, async (sql) => (await sql<{ close_reason: string | null }[]>`
    SELECT close_reason FROM support.admin_break_glass_log WHERE id = ${id}`)[0]?.close_reason ?? null);
const runMigration = async () => {
  const text = readFileSync(new URL("../migrations/0052_break_glass_close_reason.sql", import.meta.url), "utf8");
  await sqlClient.unsafe(text); // owner role, no tenant GUC, like bootstrap
};

beforeAll(async () => {
  await insertClosed(SWEPT, T1, SYSTEM_ACTOR);
  await insertClosed(MANUAL, T2, OPERATOR);
  await runMigration();
});
afterAll(async () => {
  for (const t of TENANTS) {
    await asTenant(t, (sql) => sql`DELETE FROM support.admin_break_glass_log WHERE tenant_id = ${t}`);
  }
  await sqlClient.end();
});

describe("migration 0052 close_reason backfill under FORCE RLS", () => {
  it("backfills a pre-existing sweeper-closed grant as auto_expired", async () => {
    expect(await reason(SWEPT, T1)).toBe("auto_expired");
  });
  it("backfills a pre-existing operator-closed grant as manual", async () => {
    expect(await reason(MANUAL, T2)).toBe("manual");
  });
  it("leaves FORCE ROW LEVEL SECURITY enabled afterwards", async () => {
    const [r] = await sqlClient<{ relforcerowsecurity: boolean }[]>`
      SELECT relforcerowsecurity FROM pg_class WHERE oid = 'support.admin_break_glass_log'::regclass`;
    expect(r?.relforcerowsecurity).toBe(true);
  });
  it("a second run is idempotent", async () => {
    await runMigration();
    expect(await reason(SWEPT, T1)).toBe("auto_expired");
    expect(await reason(MANUAL, T2)).toBe("manual");
  });
});
