/**
 * D4c #45: the estimate a quotation is compared with is the work's estimated cost, found through the pre-tender (or
 * tender) of the tender id; the award result is the latest award on that work. Real Postgres (works_svc, FORCE RLS).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { workProposals } from "../src/modules/proposal/schema.js";
import { preTenders, tenders, awards } from "../src/modules/tender/schema.js";
import { getTenderEstimate, getAwardForWork } from "../src/modules/tender/repo.js";

const TENANT = `d4c45000-0000-4000-8000-${randomUUID().slice(24)}`;
const OTHER = `d4c45000-0000-4000-8000-${randomUUID().slice(24)}`;
const ACTOR = randomUUID();
const inTx = <T>(t: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(t, () => db.transaction(fn));

afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${t}, true)`;
      for (const tbl of ["works.awards", "works.tenders", "works.pre_tenders", "works.work_proposals"]) await sql.unsafe(`DELETE FROM ${tbl} WHERE tenant_id = '${t}'`);
    });
  }
  await sqlClient.end();
});

async function seedWork(tenant: string, cost: bigint) {
  const id = randomUUID();
  await inTx(tenant, (tx) => tx.insert(workProposals).values({
    id, tenantId: tenant, workNumber: `W/${id.slice(0, 6)}`, category: "regular", description: "d4c45", workTypeId: randomUUID(),
    estimatedCostMinor: cost, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

describe("getTenderEstimate (real DB)", () => {
  it("resolves the estimate through a pre-tender", async () => {
    const workId = await seedWork(TENANT, 12345600n);
    const tenderId = randomUUID();
    await inTx(TENANT, (tx) => tx.insert(preTenders).values({ id: tenderId, tenantId: TENANT, workId, createdBy: ACTOR }));
    expect(await runWithTenant(TENANT, () => getTenderEstimate(TENANT, tenderId))).toEqual({ workId, estimateMinor: 12345600n });
  });

  it("resolves the estimate through a tender too", async () => {
    const workId = await seedWork(TENANT, 777n);
    const tenderId = randomUUID();
    await inTx(TENANT, (tx) => tx.insert(tenders).values({ id: tenderId, tenantId: TENANT, workId, tenderAmountMinor: 1n, createdBy: ACTOR }));
    expect((await runWithTenant(TENANT, () => getTenderEstimate(TENANT, tenderId)))?.estimateMinor).toBe(777n);
  });

  it("a zero estimate is reported as null (no number to compare with); an unknown or other-tenant tender is null", async () => {
    const workId = await seedWork(TENANT, 0n);
    const tenderId = randomUUID();
    await inTx(TENANT, (tx) => tx.insert(preTenders).values({ id: tenderId, tenantId: TENANT, workId, createdBy: ACTOR }));
    expect((await runWithTenant(TENANT, () => getTenderEstimate(TENANT, tenderId)))?.estimateMinor).toBeNull();
    expect(await runWithTenant(TENANT, () => getTenderEstimate(TENANT, randomUUID()))).toBeNull();
    expect(await runWithTenant(OTHER, () => getTenderEstimate(OTHER, tenderId))).toBeNull();
  });
});

describe("getAwardForWork (real DB)", () => {
  it("returns the newest award of the work, none when there is none, never another tenant's", async () => {
    const workId = randomUUID();
    expect(await runWithTenant(TENANT, () => getAwardForWork(TENANT, workId))).toBeNull();
    const mk = (id: string, name: string, createdAt: Date) => inTx(TENANT, (tx) => tx.insert(awards).values({ id, tenantId: TENANT, workId, contractorName: name, acceptedAmountMinor: 1n, createdBy: ACTOR, createdAt }));
    const older = randomUUID(); const newer = randomUUID();
    await mk(older, "Old Co", new Date("2026-01-01T00:00:00Z"));
    await mk(newer, "New Co", new Date("2026-06-01T00:00:00Z"));
    expect((await runWithTenant(TENANT, () => getAwardForWork(TENANT, workId)))?.id).toBe(newer);
    expect(await runWithTenant(OTHER, () => getAwardForWork(OTHER, workId))).toBeNull();
  });
});
