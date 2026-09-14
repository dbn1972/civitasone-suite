import { describe, it } from "vitest";
import { assertP95 } from "@civitasone/db/perf";

const dbUrl = process.env.DB_URL;

// FLAKY-SKIP: p95 perf benchmark against a real Postgres (DB_URL); intentionally not run in standard CI, only in a dedicated perf lane — tracked here so it isn't invisible. (expires: 2026-12-13)
describe.skipIf(!dbUrl)("finance payments query perf (p95)", () => {
  const tenantId = "00000000-0000-0000-0000-000000000001";

  it("listPaymentsByTenant p95 under 50ms", async () => {
    const { listPaymentsByTenant } = await import("../src/modules/payments/repo.js");
    await assertP95(
      async () => { await listPaymentsByTenant(tenantId, 50, 0); },
      { p95Ms: 50, samples: 15, warmup: 3 },
    );
  });
});
