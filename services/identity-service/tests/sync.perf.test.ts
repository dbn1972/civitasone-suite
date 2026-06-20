import { describe, it, expect } from "vitest";
import { assertP95, assertIndexUsed } from "@civitasone/db/perf";
import { createSqlClient } from "@civitasone/db";

const dbUrl = process.env.DB_URL;

describe.skipIf(!dbUrl)("identity sync query perf (p95)", () => {
  const tenantId = "00000000-0000-0000-0000-000000000001";

  it("pullSince p95 under 50ms budget", async () => {
    const { pullSince } = await import("../src/modules/devices/repo.js");
    await assertP95(
      async () => { await pullSince(tenantId, "approvals", 0n, 50); },
      { p95Ms: 50, samples: 15, warmup: 3 },
    );
  });

  it("pullSince uses index on changelog", async () => {
    const sql = createSqlClient(dbUrl);
    const rows = await sql.unsafe(
      `EXPLAIN SELECT * FROM sync.entity_changelog
       WHERE tenant_id = $1 AND mailbox = $2 AND seq > 0
       ORDER BY seq ASC LIMIT 50`,
      [tenantId, "approvals"],
    );
    const plan = rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n");
    assertIndexUsed(plan);
    await sql.end();
  });
});
