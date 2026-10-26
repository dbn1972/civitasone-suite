/**
 * GAP-ESTAB-QUARTERS-04 (owner decision #31): quarter Category is a CLOSED list; legacy free-text values
 * are mapped onto it and anything unmappable becomes "Other (legacy)" (other_legacy). Real DB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { QUARTER_CATEGORIES, QUARTER_CATEGORY_LEGACY } from "../src/modules/quarters/validators.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0ff33aa-0000-4000-8000-000000000e31";
const ACTOR = randomUUID();
const hdr = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["estab_officer"], sid: "s-d31" }, SECRET)}`,
  "x-tenant-id": TENANT, "content-type": "application/json",
});

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM quarters.estab_quarters WHERE tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

const create = (category?: string) =>
  app.inject({ method: "POST", url: "/v1/estab/quarters", headers: hdr(),
    payload: { quarterNo: `Q-${randomUUID().slice(0, 6)}`, quarterType: "type_iv", ...(category !== undefined ? { category } : {}) } });

async function insertRaw(category: string) {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO quarters.estab_quarters (id, tenant_id, quarter_no, quarter_type, category, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${"RAW-" + randomUUID().slice(0, 6)}, 'type_iv', ${category}, ${ACTOR}, ${ACTOR})`;
  });
}

describe("quarter category is a closed list (owner decision #31)", () => {
  it("exports the closed list, with other_legacy reserved for migrated rows only", () => {
    expect([...QUARTER_CATEGORIES]).toEqual(["general", "physically_handicapped", "medical", "defence", "other"]);
    expect(QUARTER_CATEGORY_LEGACY).toBe("other_legacy");
  });

  it("accepts every member of the list and publishes it unchanged", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    for (const c of QUARTER_CATEGORIES) {
      const res = await create(c);
      expect(res.statusCode, c).toBe(202);
    }
    const cats = spy.mock.calls.filter((c) => c[0] === "estab.quarter.create").map((c) => (c[1].payload as { category: string }).category);
    expect(cats).toEqual([...QUARTER_CATEGORIES]);
    spy.mockRestore();
  });

  it("defaults to general when omitted", async () => {
    const spy = vi.spyOn(appQueue, "publish").mockResolvedValue(undefined);
    expect((await create()).statusCode).toBe(202);
    expect((spy.mock.calls.find((c) => c[0] === "estab.quarter.create")![1].payload as { category: string }).category).toBe("general");
    spy.mockRestore();
  });

  it("rejects free text, and rejects other_legacy (a migration-only value) from the API with 400", async () => {
    for (const c of ["pwd", "Type IV", "", "other_legacy"]) {
      const res = await create(c);
      expect(res.statusCode, c).toBe(400);
    }
  });

  it("the database refuses a category outside the closed list + other_legacy", async () => {
    await expect(insertRaw("totally made up")).rejects.toThrow(/chk_estab_quarters_category|check constraint/i);
    await expect(insertRaw("other_legacy")).resolves.toBeUndefined();
    await expect(insertRaw("medical")).resolves.toBeUndefined();
  });
});

describe("legacy category mapping (owner decision #31)", () => {
  const cases: Array<[string, string]> = [
    ["general", "general"], ["General", "general"], ["  GEN ", "general"], ["general pool", "general"], ["general-pool", "general"],
    ["physically_handicapped", "physically_handicapped"], ["PH", "physically_handicapped"], ["Physically Handicapped", "physically_handicapped"],
    ["pwd", "physically_handicapped"], ["Divyang", "physically_handicapped"],
    ["medical", "medical"], ["Medical Ground", "medical"],
    ["defence", "defence"], ["Defense", "defence"], ["Army", "defence"],
    ["other", "other"], ["Others", "other"],
    ["Type IV", "other_legacy"], ["VIP", "other_legacy"], ["", "other_legacy"], ["   ", "other_legacy"],
  ];
  it.each(cases)("maps %j -> %s", async (input, expected) => {
    const rows = await sqlClient`SELECT quarters.map_legacy_category(${input}) AS mapped`;
    expect(rows[0]!.mapped).toBe(expected);
  });

  it("the backfill statement maps every legacy row onto the closed list and leaves valid rows alone", async () => {
    const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
    let seen: Array<{ id: string; category: string }> = [];
    const ROLLBACK = new Error("rollback");
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`ALTER TABLE quarters.estab_quarters DROP CONSTRAINT chk_estab_quarters_category`;
      for (const [id, cat] of [[ids.a, "pwd"], [ids.b, "Executive Class"], [ids.c, "medical"]] as const) {
        await sql`INSERT INTO quarters.estab_quarters (id, tenant_id, quarter_no, quarter_type, category, created_by, updated_by)
          VALUES (${id}, ${TENANT}, ${"BF-" + id.slice(0, 6)}, 'type_iv', ${cat}, ${ACTOR}, ${ACTOR})`;
      }
      await sql`UPDATE quarters.estab_quarters SET category = quarters.map_legacy_category(category)
        WHERE tenant_id = ${TENANT}
          AND category NOT IN ('general','physically_handicapped','medical','defence','other','other_legacy')`;
      seen = await sql`SELECT id, category FROM quarters.estab_quarters WHERE id IN ${sql([ids.a, ids.b, ids.c])}`;
      throw ROLLBACK; // undo the dropped constraint and the fixture rows
    }).catch((e) => { if (e !== ROLLBACK) throw e; });
    const by = new Map(seen.map((r) => [r.id, r.category]));
    expect(by.get(ids.a)).toBe("physically_handicapped");
    expect(by.get(ids.b)).toBe("other_legacy");
    expect(by.get(ids.c)).toBe("medical");
  });
});
