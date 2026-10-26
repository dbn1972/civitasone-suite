/**
 * GAP-LEGAL-HEARINGS-05: migration 0030 must apply over a pre-existing legacy
 * reminder row on a FORCE-RLS table (a migration has no tenant GUC).
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlClient } from "../src/shared/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TENANT = "11111111-aaaa-4000-8000-0000000b30a4";

afterAll(async () => {
  await sqlClient.end();
});

describe("GAP-LEGAL-HEARINGS-05: 0030 back-fill over a legacy row", () => {
  it("back-fills and applies NOT NULL when the table has FORCE RLS and a legacy row exists", async () => {
    const migration = readFileSync(join(__dirname, "../migrations/0030_reminders_schema_align.sql"), "utf8");
    const scoped = migration.replaceAll("reminders.legal_reminders", "uat_r0030.legal_reminders");
    expect(scoped).not.toContain("reminders.legal_reminders");

    const ROLLBACK = new Error("rollback");
    let row: Record<string, unknown> | undefined;
    let forced: unknown;
    await sqlClient
      .begin(async (tx) => {
        await tx.unsafe("CREATE SCHEMA uat_r0030");
        // Legacy shape from 0003 + FORCE RLS tenant policy as in 0008/0010.
        await tx.unsafe(`CREATE TABLE uat_r0030.legal_reminders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          case_id UUID NOT NULL,
          reminder_date DATE NOT NULL,
          reminder_type VARCHAR(32) NOT NULL DEFAULT 'hearing',
          description TEXT,
          is_sent BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await tx.unsafe(`INSERT INTO uat_r0030.legal_reminders (tenant_id, case_id, reminder_date, description, is_sent)
          VALUES ('${TENANT}', gen_random_uuid(), '2030-05-06', 'legacy prep', true)`);
        await tx.unsafe("ALTER TABLE uat_r0030.legal_reminders ENABLE ROW LEVEL SECURITY");
        await tx.unsafe(`CREATE POLICY t ON uat_r0030.legal_reminders
          USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`);
        await tx.unsafe("ALTER TABLE uat_r0030.legal_reminders FORCE ROW LEVEL SECURITY");

        await tx.unsafe(scoped);

        forced = (await tx.unsafe("SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'uat_r0030.legal_reminders'::regclass"))[0]?.f;
        await tx.unsafe("ALTER TABLE uat_r0030.legal_reminders NO FORCE ROW LEVEL SECURITY");
        row = (await tx.unsafe("SELECT remind_at, message, sent, created_by FROM uat_r0030.legal_reminders"))[0];
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });

    expect(forced).toBe(true);
    expect(row).toBeDefined();
    expect(row?.message).toBe("legacy prep");
    expect(row?.sent).toBe(true);
    expect(new Date(String(row?.remind_at)).toISOString()).toBe("2030-05-06T00:00:00.000Z");
    expect(row?.created_by).toBe("00000000-0000-0000-0000-000000000000");
  });
});
