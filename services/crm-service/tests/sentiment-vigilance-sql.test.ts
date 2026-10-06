/**
 * Vigilance filtering happens in SQL so paging and `total` are correct for a
 * caller outside the vigilance set (previously the page was fetched first and
 * filtered after, giving short/empty pages and a wrong total).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { listSentiments, getVocSummary } from "../src/modules/sentiment/queries.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e7";
const ACTOR = "cccccccc-3333-4000-8000-0000000000e7";

const inTenant = <T,>(fn: () => Promise<T>): Promise<T> => runWithTenant(TENANT, fn);

async function seed(themes: string[], minutesAgo: number): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.interaction_sentiments
        (tenant_id, activity_id, polarity, score, themes, created_by, updated_by, analysed_at)
      VALUES (${TENANT}, ${randomUUID()}, 'negative', -50, ${JSON.stringify(themes)}::jsonb,
              ${ACTOR}, ${ACTOR}, now() - (${minutesAgo} || ' minutes')::interval)`;
  });
}

describe("VoC vigilance filter is applied in SQL (paging + total)", () => {
  beforeAll(async () => {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.interaction_sentiments WHERE tenant_id = ${TENANT}`;
    });
    // Newest three carry vigilance themes; the two older ones are clean.
    await seed(["corruption"], 1);
    await seed(["staff_conduct", "billing"], 2);
    await seed(["corruption", "delay"], 3);
    await seed(["billing"], 4);
    await seed([], 5);
  });

  it("a non-vigilance caller gets a FULL first page and an accurate total", async () => {
    const res = await inTenant(() => listSentiments(TENANT, 2, 0, { excludeSensitive: true }));
    expect(res.rows).toHaveLength(2);
    expect(res.total).toBe(2);
    expect(res.rows.every((r) => !r.themes.includes("corruption") && !r.themes.includes("staff_conduct"))).toBe(true);
  });

  it("pages through only visible rows (offset skips visible rows, not hidden ones)", async () => {
    const page2 = await inTenant(() => listSentiments(TENANT, 1, 1, { excludeSensitive: true }));
    expect(page2.rows).toHaveLength(1);
    expect(page2.total).toBe(2);
  });

  it("a vigilance caller still sees every reading", async () => {
    const res = await inTenant(() => listSentiments(TENANT, 10, 0, {}));
    expect(res.total).toBe(5);
    expect(res.rows).toHaveLength(5);
  });

  it("the summary excludes vigilance readings before aggregation", async () => {
    const s = await inTenant(() => getVocSummary(TENANT, { excludeSensitive: true }));
    expect(s.total).toBe(2);
    expect(s.topThemes.map((t) => t.theme)).not.toContain("corruption");
  });
});
