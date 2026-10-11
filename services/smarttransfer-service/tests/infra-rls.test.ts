/**
 * FORCE RLS on the two tenant_id infra tables + the scanner-role split (D-20).
 *
 * _outbox.messages and _inbox.command_results are FORCE RLS (0001). The
 * NOBYPASSRLS smarttransfer_svc role sees only its own tenant's rows; the
 * cross-tenant relay/purge runs as the BYPASSRLS smarttransfer_scanner role
 * (0002), which has exactly the grants those loops issue and no write path on
 * command_results (D-20: scanner-role purge only).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { sql } from "drizzle-orm";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

const scanner = postgres(process.env.SMARTTRANSFER_SCANNER_DATABASE_URL as string, { max: 1 });

afterAll(async () => {
  await scanner.end();
  await sqlClient.end();
});

describe("FORCE RLS on infra tables", () => {
  it("both tables are ENABLE + FORCE row level security", async () => {
    const rows = await sqlClient`
      SELECT c.oid::regclass::text AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c WHERE c.oid IN ('_outbox.messages'::regclass, '_inbox.command_results'::regclass)`;
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.rls).toBe(true);
      expect(r.forced).toBe(true);
    }
  });

  it("a tenant-A row in each table is invisible without a GUC and to tenant B, visible to A", async () => {
    const messageId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO _outbox.messages (topic, event_type, tenant_id, actor_id, correlation_id, payload)
          VALUES ('audit.event.record', 'test', ${TENANT_A}::uuid, ${ACTOR}::uuid, 'c-rls', '{}'::jsonb)`);
        await tx.execute(sql`
          INSERT INTO _inbox.command_results (message_id, tenant_id, topic, status)
          VALUES (${messageId}::uuid, ${TENANT_A}::uuid, 'smarttransfer.cycle.create', 'succeeded')`);
      }),
    );

    const noGucOutbox = await sqlClient`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${TENANT_A}`;
    const noGucResults = await sqlClient`SELECT 1 FROM _inbox.command_results WHERE tenant_id = ${TENANT_A}`;
    expect(noGucOutbox.length).toBe(0);
    expect(noGucResults.length).toBe(0);

    const asB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.execute(sql`SELECT 1 FROM _inbox.command_results WHERE message_id = ${messageId}::uuid`)),
    );
    expect(asB.length).toBe(0);

    const asA = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.execute(sql`SELECT 1 FROM _inbox.command_results WHERE message_id = ${messageId}::uuid`)),
    );
    expect(asA.length).toBe(1);

    // A tenant cannot WRITE another tenant's row either (WITH CHECK).
    await expect(
      runWithTenant(TENANT_B, () =>
        db.transaction((tx) =>
          tx.execute(sql`
            INSERT INTO _inbox.command_results (message_id, tenant_id, topic, status)
            VALUES (${randomUUID()}::uuid, ${TENANT_A}::uuid, 'x', 'succeeded')`),
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("scanner role (cross-tenant relay/purge)", () => {
  it("is BYPASSRLS, sees every tenant's outbox + command_results rows, and the service role has no DELETE on command_results", async () => {
    const [who] = await scanner`SELECT current_user AS u, r.rolbypassrls AS bypass, r.rolsuper AS su FROM pg_roles r WHERE r.rolname = current_user`;
    expect(who!.u).toBe("smarttransfer_scanner");
    expect(who!.bypass).toBe(true);
    expect(who!.su).toBe(false);

    const outbox = await scanner`SELECT DISTINCT tenant_id FROM _outbox.messages WHERE tenant_id = ${TENANT_A}`;
    expect(outbox.length).toBe(1);

    // Purge path: scanner can delete a command_results row across tenants.
    const del = await scanner`DELETE FROM _inbox.command_results WHERE tenant_id = ${TENANT_A} RETURNING message_id`;
    expect(del.length).toBeGreaterThan(0);

    // smarttransfer_svc must NOT be able to purge (scanner-role purge only).
    await expect(
      runWithTenant(TENANT_A, () =>
        db.transaction((tx) => tx.execute(sql`DELETE FROM _inbox.command_results WHERE tenant_id = ${TENANT_A}::uuid`)),
      ),
    ).rejects.toThrow();

    // The scanner has no INSERT path on command_results.
    await expect(
      scanner`INSERT INTO _inbox.command_results (message_id, tenant_id, topic, status) VALUES (${randomUUID()}, ${TENANT_A}, 'x', 'succeeded')`,
    ).rejects.toThrow();
  });
});
