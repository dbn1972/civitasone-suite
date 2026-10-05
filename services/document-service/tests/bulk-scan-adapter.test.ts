/** OCR adapter mapping (pure parts) + the cross-tenant scanner role (needs a superuser URL; skipped when absent). */
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { preprocessConfig, classifierConfigFor } from "../src/modules/bulk-scan/ocr-adapter.js";
import { DEFAULT_SETTINGS } from "../src/modules/bulk-scan/settings.js";
import { settingsSchema } from "../src/modules/bulk-scan/validators.js";
import { scannerDiscovery } from "../src/modules/bulk-scan/dispatcher.js";
import * as repo from "../src/modules/bulk-scan/repo.js";
import { schema } from "../src/modules/bulk-scan/schema.js";
import { sqlClient } from "../src/shared/db.js";
import { insertBatchRow, insertFileRow } from "./bulk-scan-helpers.js";

afterAll(async () => { await sqlClient.end(); });

describe("@civitasone/ocr adapter mapping", () => {
  it("maps tenant preprocessing steps to the package's switches", () => {
    expect(preprocessConfig(["rotate", "deskew"], 400)).toEqual({
      dpi: 400, autoOrient: true, deskew: true, grayscale: false, normalise: false, denoise: false, binarise: false, cropBorder: false,
    });
    expect(preprocessConfig(["grayscale", "contrast", "denoise", "binarize", "crop"], 300)).toMatchObject({
      autoOrient: false, grayscale: true, normalise: true, denoise: true, binarise: true, cropBorder: true,
    });
  });

  it("layers tenant doc types over the package defaults", () => {
    const cfg = classifierConfigFor(settingsSchema.parse({
      classification: { uncertainBelow: 0.6, docTypes: [
        { id: "pay_slip", label: "Salary slip", keywords: ["emoluments"] },
        { id: "gazette", label: "Gazette", keywords: ["extraordinary gazette"] },
        { id: "other", label: "Other" },
      ] },
    }));
    expect(cfg.types.map((t) => t.id)).toEqual(["pay_slip", "gazette", "other"]);
    const pay = cfg.types.find((t) => t.id === "pay_slip");
    expect(pay?.label).toBe("Salary slip");
    expect(pay?.keywords.some((k) => k.term === "emoluments")).toBe(true);
    expect((pay?.keywords.length ?? 0)).toBeGreaterThan(1);                     // package defaults retained
    expect(cfg.types.find((t) => t.id === "gazette")?.keywords).toEqual([{ term: "extraordinary gazette", weight: 2 }]);
    expect(cfg.minConfidence).toBe(0.6);
    expect(classifierConfigFor(DEFAULT_SETTINGS).types).toHaveLength(9);
  });
});

const SU = process.env.BULK_SCAN_TEST_SUPERUSER_URL;
// FLAKY-SKIP: environment-gated on BULK_SCAN_TEST_SUPERUSER_URL (a superuser DB URL to read role grants); deterministic when set, not flaky (expires: 2027-10-01)
describe.skipIf(!SU)("document_scanner role: cross-tenant read-only discovery (migration 0007)", () => {
  it("sees every tenant's due work (BYPASSRLS), cannot write, while document_svc sees none without a GUC", async () => {
    const admin = postgres(SU as string, { max: 1 });
    try {
      await admin.unsafe("ALTER ROLE document_scanner PASSWORD 'scanner_test_pw'");
      const u = new URL(SU as string);
      u.username = "document_scanner"; u.password = "scanner_test_pw";
      const scan = postgres(u.toString(), { max: 1 });
      try {
        const t1 = randomUUID(), t2 = randomUUID();
        const b1 = await insertBatchRow(t1), b2 = await insertBatchRow(t2);
        const f1 = await insertFileRow(t1, b1, "queued"), f2 = await insertFileRow(t2, b2, "scan_pending");
        const disc = scannerDiscovery(drizzle(scan, { schema }) as never);
        const now = new Date();
        const tenants = await disc.dueTenants(now, 10_000);
        expect(tenants).toContain(t1);
        expect(tenants).toContain(t2);
        expect((await disc.dueFiles(t1, now, 10)).map((d) => d.fileId)).toEqual([f1]);
        expect((await disc.dueFiles(t2, now, 10)).map((d) => [d.fileId, d.state])).toEqual([[f2, "scan_pending"]]);
        await expect(scan.unsafe("UPDATE bulk_scan.batch_files SET state='failed'")).rejects.toThrow(/permission denied/);
        await expect(scan.unsafe("SELECT 1 FROM bulk_scan.settings")).rejects.toThrow(/permission denied/);
        // the same discovery through the RLS-bound service role (no GUC) finds nothing
        const none = await runWithTenant(randomUUID(), () => scannerDiscovery(drizzle(postgres(process.env.DATABASE_URL as string, { max: 1 }), { schema }) as never).dueTenants(now, 100));
        expect(none).not.toContain(t1);
      } finally { await scan.end(); }
    } finally { await admin.end(); }
  });

  const ANCIENT = (n: number): Date => new Date(Date.UTC(2001, 0, 1, 0, 0, n));

  it("discovery fairness: discoverDueTenants serves OLDEST due work first: tenants that keep getting new work cannot starve the others (every tenant served across calls)", async () => {
    const su = postgres(SU as string, { max: 1 });
    try {
      const rdb = drizzle(su, { schema }) as never;
      const tenants = Array.from({ length: 5 }, () => randomUUID()).sort();         // ascending tenant ids: the old ORDER BY tenant_id would always pick the first two
      const batch = new Map<string, string>();
      const oldFile = new Map<string, string>();
      for (const [i, t] of tenants.entries()) {
        const b = await insertBatchRow(t);
        batch.set(t, b);
        oldFile.set(t, await insertFileRow(t, b, "queued", { createdAt: ANCIENT(i) }));
      }
      const served = new Set<string>();
      const rounds: string[][] = [];
      const now = new Date();
      for (let round = 0; round < 3; round++) {
        const picked = (await repo.discoverDueTenants(rdb, now, 2)).filter((t) => tenants.includes(t));
        rounds.push(picked);
        for (const t of picked) {
          served.add(t);
          // "serve" the tenant (its old file leaves the due set) but it immediately has NEW work, so it stays due
          await su.unsafe("UPDATE bulk_scan.batch_files SET state = 'cancelled' WHERE id = $1", [oldFile.get(t) as string]);
          oldFile.set(t, await insertFileRow(t, batch.get(t) as string, "queued", { createdAt: now }));
        }
      }
      expect([...served].sort()).toEqual(tenants);
      expect(rounds.map((r) => r.length)).toEqual([2, 2, 1]);
      await su.unsafe("UPDATE bulk_scan.batch_files SET state = 'cancelled' WHERE tenant_id = ANY($1::uuid[])", [tenants]);
    } finally { await su.end(); }
  });

  it("discoverExpiredLeases ranks the oldest expired lease of EACH tenant first, so a big backlog cannot hide another tenant", async () => {
    const su = postgres(SU as string, { max: 1 });
    try {
      const rdb = drizzle(su, { schema }) as never;
      const a = randomUUID(), b = randomUUID();
      const ba = await insertBatchRow(a), bb = await insertBatchRow(b);
      const lease = (n: number) => ({ leaseExpiresAt: ANCIENT(n), leaseOwner: randomUUID() });
      const a1 = await insertFileRow(a, ba, "scanning", lease(1));
      const a2 = await insertFileRow(a, ba, "scanning", lease(2));
      await insertFileRow(a, ba, "scanning", lease(3));
      const b1 = await insertFileRow(b, bb, "ocr_running", lease(100));
      const top = (await repo.discoverExpiredLeases(rdb, new Date(), 2)).map((x) => x.fileId);
      expect(top).toEqual([a1, b1]);                                                   // by lease age alone it would be [a1, a2]
      expect(top).not.toContain(a2);
      await su.unsafe("UPDATE bulk_scan.batch_files SET state = 'cancelled', lease_expires_at = NULL, lease_owner = NULL WHERE tenant_id = ANY($1::uuid[])", [[a, b]]);
    } finally { await su.end(); }
  });
});
