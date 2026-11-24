/**
 * UAT: /works/tenders was always empty - the register read works.tenders, which has no producer, while every
 * real tender is a works.pre_tenders row. The register now lists both (tenant-scoped). Real Postgres (works_svc, FORCE RLS).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { preTenders, tenders } from "../src/modules/tender/schema.js";
import { listTenders, countTenders, getTenderById } from "../src/modules/tender/repo.js";

const TENANT = `d4c41000-0000-4000-8000-${randomUUID().slice(24)}`;
const OTHER = `d4c41000-0000-4000-8000-${randomUUID().slice(24)}`;
const ACTOR = randomUUID();
const inTx = <T>(tenant: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction(fn));

const as = <T>(tenant: string, fn: () => Promise<T>) => runWithTenant(tenant, fn);
const PRE = randomUUID();
const PRE_OTHER = randomUUID();
const REAL = randomUUID();

afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${t}, true)`;
      for (const tbl of ["works.pre_tenders", "works.tenders"]) await sql.unsafe(`DELETE FROM ${tbl} WHERE tenant_id = '${t}'`);
    });
  }
  await sqlClient.end();
});

describe("tender register lists pre-tenders (real DB)", () => {
  it("shows a pre-tender when works.tenders is empty, with status, and counts it", async () => {
    await inTx(TENANT, (tx) => tx.insert(preTenders).values({ id: PRE, tenantId: TENANT, workId: randomUUID(), status: "finalized", createdBy: ACTOR }));
    await inTx(OTHER, (tx) => tx.insert(preTenders).values({ id: PRE_OTHER, tenantId: OTHER, workId: randomUUID(), createdBy: ACTOR }));

    const rows = await as(TENANT, () => listTenders(TENANT, 1, 50));
    expect(rows.map((r) => r.id)).toEqual([PRE]);
    expect(rows[0]).toMatchObject({ status: "finalized", tenderAmountMinor: null, approvingAuthorityId: null });
    expect(await as(TENANT, () => countTenders(TENANT))).toBe(1);
  });

  it("is tenant-scoped and resolves a pre-tender by id for the detail page", async () => {
    expect((await as(TENANT, () => getTenderById(TENANT, PRE)))?.id).toBe(PRE);
    expect(await as(TENANT, () => getTenderById(TENANT, PRE_OTHER))).toBeNull();
    expect((await as(OTHER, () => listTenders(OTHER, 1, 50))).map((r) => r.id)).toEqual([PRE_OTHER]);
  });

  it("merges real works.tenders rows with pre-tenders, newest first, paged, total = both", async () => {
    await inTx(TENANT, (tx) => tx.insert(tenders).values({ id: REAL, tenantId: TENANT, workId: randomUUID(), tenderAmountMinor: 500000n, createdBy: ACTOR, createdAt: new Date(Date.now() + 60_000) }));
    const rows = await as(TENANT, () => listTenders(TENANT, 1, 50));
    expect(rows.map((r) => r.id)).toEqual([REAL, PRE]);
    expect(rows[0]).toMatchObject({ tenderAmountMinor: 500000n, status: null });
    expect((await as(TENANT, () => listTenders(TENANT, 2, 1))).map((r) => r.id)).toEqual([PRE]);
    expect(await as(TENANT, () => countTenders(TENANT))).toBe(2);
    expect((await as(TENANT, () => getTenderById(TENANT, REAL)))?.id).toBe(REAL);
  });
});
