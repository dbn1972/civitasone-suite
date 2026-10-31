/**
 * UAT F84: document-worker refuses to start when its bulk-scan scanner pool cannot bypass RLS
 * (e.g. the development / test fallback to DATABASE_URL = document_svc, NOBYPASSRLS after admin-service 0058),
 * instead of running a dispatcher / sweeper / retention that silently finds no work.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertScannerBypassesRls, type ScannerRoleQuery } from "../src/shared/scanner-guard.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });

const fake = (rows: Array<Record<string, unknown>>): ScannerRoleQuery => async () => rows;

describe("F84 scanner pool BYPASSRLS start-up guard", () => {
  it("passes for a BYPASSRLS role (document_scanner)", async () => {
    await expect(assertScannerBypassesRls(fake([{ role: "document_scanner", rolbypassrls: true }]))).resolves.toBe("document_scanner");
  });

  it("throws a clear error for a NOBYPASSRLS role", async () => {
    await expect(assertScannerBypassesRls(fake([{ role: "document_svc", rolbypassrls: false }])))
      .rejects.toThrow(/connects as 'document_svc', which cannot bypass RLS.*DOCUMENT_SCANNER_DATABASE_URL/s);
  });

  it("throws when the role cannot be resolved", async () => {
    await expect(assertScannerBypassesRls(fake([]))).rejects.toThrow(/cannot bypass RLS/);
  });

  it("document-worker runs the guard on the scanner pool before starting any scanner-driven scheduler", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/worker.ts", import.meta.url)), "utf8");
    const guard = src.indexOf("await assertScannerBypassesRls(scannerSqlClient");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf("startBulkScanScheduler({"));
    expect(guard).toBeLessThan(src.indexOf("startRetentionScheduler({"));
  });

  it("real DB: the DATABASE_URL fallback (document_svc, NOBYPASSRLS) is refused", async () => {
    await expect(assertScannerBypassesRls(sqlClient as unknown as ScannerRoleQuery)).rejects.toThrow(/connects as 'document_svc'/);
  });
});
