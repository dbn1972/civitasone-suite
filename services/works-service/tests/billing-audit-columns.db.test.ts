/**
 * GAP2-WORKS-BILLING-08: the billing entities that underpin financial bills —
 * works.measurement_books, works.measurements, works.bill_items,
 * works.bill_recoveries — must carry the mandatory record-provenance audit
 * columns required by CLAUDE.md rule 6 (created_at, created_by, updated_at,
 * updated_by). Before migration 0026 these tables carried only `version`
 * (+ tenantId), so this DB-backed check fails on the old schema.
 *
 * DB-backed against the real Postgres (DATABASE_URL from vitest.config.ts,
 * port 5672), mirroring the information_schema style used elsewhere.
 */
import { describe, it, expect, afterAll } from "vitest";
import { sqlClient } from "../src/shared/db.js";

const TABLES = ["measurement_books", "measurements", "bill_items", "bill_recoveries"] as const;
const REQUIRED = ["created_at", "created_by", "updated_at", "updated_by"] as const;

afterAll(async () => { await sqlClient.end(); });

describe("GAP2-WORKS-BILLING-08: billing audit columns", () => {
  for (const table of TABLES) {
    it(`works.${table} has created_at/created_by/updated_at/updated_by`, async () => {
      const rows = await sqlClient<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'works' AND table_name = ${table}
          AND column_name IN ('created_at', 'created_by', 'updated_at', 'updated_by')
      `;
      const cols = new Set(rows.map((r) => r.column_name));
      for (const c of REQUIRED) {
        expect(cols.has(c), `works.${table}.${c} is missing`).toBe(true);
      }
    });
  }
});
