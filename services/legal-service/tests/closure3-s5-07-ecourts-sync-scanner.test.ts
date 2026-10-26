/**
 * CLOS3-S5-07 (always-on, no DB): discovery goes through the scanner pool, every
 * per-matter DB write runs inside db.transaction under that matter's tenant
 * context, and the scanner role migration is least-privilege.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentTenantId } from "@civitasone/db";

const H = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; tenantId: string; caseId: string; cnrNumber: string }>,
  txTenants: [] as Array<string | undefined>,
  plainDbCalls: 0,
}));

// A thenable drizzle-ish chain: any method returns the chain; awaiting resolves [].
const chain = (): unknown => new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res([]) : chain()),
  apply: () => chain(),
});

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      H.txTenants.push(getCurrentTenantId());
      return cb(chain());
    },
    select: () => { H.plainDbCalls++; return chain(); },
    update: () => { H.plainDbCalls++; return chain(); },
    insert: () => { H.plainDbCalls++; return chain(); },
  },
}));
vi.mock("../src/shared/scanner-db.js", () => ({
  scannerDb: { select: () => ({ from: () => ({ orderBy: () => ({ limit: async () => H.rows }), limit: async () => H.rows }) }) },
}));
vi.mock("../src/modules/ecourts/adapter.js", () => ({
  isEnabled: () => true,
  lookupCnr: async (cnr: string) => ({
    cnrNumber: cnr, caseStatus: "pending", courtName: "HC", lastUpdated: "2026-10-01",
    hearingDates: [{ date: "2099-01-01", purpose: "x" }], orders: [],
  }),
}));
vi.mock("@civitasone/storage", () => ({ putObject: vi.fn() }));

import { tick } from "../src/modules/ecourts/sync-consumer.js";

const A = "c3a50700-dead-4000-8000-00000000000a";
const B = "c3a50700-dead-4000-8000-00000000000b";

describe("CLOS3-S5-07 tick() tenant context", () => {
  beforeEach(() => {
    H.txTenants.length = 0;
    H.plainDbCalls = 0;
    H.rows = [
      { id: "s1", tenantId: A, caseId: "c1", cnrNumber: "CNR1" },
      { id: "s2", tenantId: B, caseId: "c2", cnrNumber: "CNR2" },
    ];
  });

  it("runs each matter's writes in a transaction under that matter's own tenant", async () => {
    const res = await tick();
    expect(res).toEqual({ synced: 2, failed: 0 });
    // per matter: 1 tx for syncMatter writes + 1 tx for the tracking-row update
    expect(H.txTenants).toEqual([A, A, B, B]);
    expect(H.plainDbCalls, "bare db statements carry no tenant GUC under FORCE RLS").toBe(0);
  });
});

describe("CLOS3-S5-07 scanner role migration 0028", () => {
  const sql = readFileSync(join(__dirname, "../migrations/0028_ecourts_scanner_role.sql"), "utf8");
  it("creates a BYPASSRLS legal_scanner role idempotently, with no password literal", () => {
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'legal_scanner'\)/);
    expect(sql).toContain("BYPASSRLS");
    expect(sql).not.toMatch(/PASSWORD\s+'[^%'][^']*'/);
    expect(sql).toContain("civitas.legal_scanner_password");
  });
  it("is SELECT-only on the single table it scans", () => {
    expect(sql).toMatch(/GRANT SELECT ON ecourts\.cause_list_syncs TO legal_scanner/);
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*legal_scanner/);
    expect(sql).not.toMatch(/GRANT[^;]*SCHEMA (cases|hearings|notices|counsel|_outbox|_inbox)[^;]*legal_scanner/);
  });
});
