import { describe, it } from "vitest";
import { assertP95 } from "@civitasone/db/perf";

const dbUrl = process.env.DB_URL;

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
