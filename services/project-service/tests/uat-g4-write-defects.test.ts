/**
 * UAT DB sweep 2026-10-28 (g4) — project-service write defects.
 *
 *  - evm/compute, ra-bills, time-extensions, penalties, resources answered 500: the F3 envelope
 *    carried BigInt paise and the queue transport JSON-encodes (BigInt is not serialisable).
 *  - PATCH /risks/:riskId was accepted (202) but the consumer had no "risk_update" op (dropped).
 *  - PATCH /projects/:id never bumped `version`.
 *  - GET /:id/evm and GET /:id/baselines were 500: project.project_baselines had the legacy shape on UAT
 *    (migration 0028 repairs it; the route itself was fine).
 *
 * The capturing queue stub JSON-encodes exactly like the real transport, so a BigInt in an
 * envelope fails here the way it failed in UAT. Real Postgres + RLS; unique per-file ids.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

const captured = vi.hoisted(() => ({ msgs: [] as Array<{ type: string; wire: string }> }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), invalidateResource: vi.fn(), makeKey: vi.fn().mockReturnValue("k") },
  queue: {
    publish: (type: string, envelope: Record<string, unknown>) => {
      // Same constraint as the real transport: JSON.stringify throws on BigInt.
      captured.msgs.push({ type, wire: JSON.stringify(envelope) });
      return Promise.resolve();
    },
  },
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { projectProjects } from "../src/modules/project/schema.js";
import { registerProjectConsumers } from "../src/modules/project/consumer.js";
import { registerF3ProjectConsumers } from "../src/modules/project/f3-consumer.js";
import { registerSchedulingConsumers } from "../src/modules/scheduling/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const PROJECT = randomUUID();
const MISSING = randomUUID();

const tx = <T>(fn: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));
const rows = async (q: ReturnType<typeof sql>) => (await tx((x) => x.execute(q))) as unknown as Array<Record<string, unknown>>;

const headers = (roles = ["project_manager"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: randomUUID() }, SECRET)}`,
  "x-tenant-id": TENANT,
});

async function drain() {
  const q = new MemoryQueue();
  // worker.ts wraps queue.subscribe so every handler runs inside the message's tenant context
  // (sets the RLS GUC); replicate that here.
  const raw = q.subscribe.bind(q);
  (q as unknown as { subscribe: unknown }).subscribe = (topic: string, h: (m: { tenantId: string }) => Promise<void>) =>
    raw(topic, (m: { tenantId: string }) => runWithTenant(m.tenantId, () => h(m)));
  registerProjectConsumers(q);
  registerF3ProjectConsumers(q);
  registerSchedulingConsumers(q);
  await q.start();
  for (const m of captured.msgs.splice(0)) await q.publish(m.type, JSON.parse(m.wire));
  await q.drain();
  await q.stop();
  return (q as unknown as MemoryQueue).dlq;
}

const clean = async () => {
  for (const t of ["project_risks", "project_evm", "project_ra_bills", "project_time_extensions", "project_penalties", "project_resources", "project_baselines"]) {
    await tx((x) => x.execute(sql.raw(`DELETE FROM project.${t} WHERE tenant_id = '${TENANT}'`)));
  }
  await tx((x) => x.delete(projectProjects).where(eq(projectProjects.tenantId, TENANT)));
};

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
beforeEach(async () => {
  captured.msgs.length = 0;
  await clean();
  await tx((x) =>
    x.insert(projectProjects).values({ id: PROJECT, tenantId: TENANT, code: `G4-${PROJECT.slice(0, 8)}`, name: "G4 fixture", createdBy: ACTOR, updatedBy: ACTOR }),
  );
});
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

const post = (path: string, payload: object) =>
  app.inject({ method: "POST", url: `/v1/projects/${PROJECT}${path}`, headers: headers(), payload });

describe("BigInt paise no longer breaks the queue envelope (was 500)", () => {
  it("POST evm/compute -> 202 and the EVM row is stored exactly", async () => {
    const res = await post("/evm/compute", { period: "2026-09", plannedValueMinor: 100000, earnedValueMinor: 80000, actualCostMinor: 90000, budgetAtCompletionMinor: 500000 });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const [r] = await rows(sql`SELECT planned_value_minor::text AS pv, eac_minor::text AS eac FROM project.project_evm WHERE tenant_id = ${TENANT} AND project_id = ${PROJECT}`);
    expect(r?.pv).toBe("100000");
    expect(r?.eac).toBe("562500"); // (500000 * 90000) / 80000
  });

  it("POST ra-bills -> 202 and stored", async () => {
    const res = await post("/ra-bills", { contractorId: randomUUID(), billNo: "RA-G4", billDate: "2026-08-01", grossAmountMinor: 200000, deductionsMinor: 20000, netAmountMinor: 180000, cumulativeMinor: 200000 });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const [r] = await rows(sql`SELECT net_amount_minor::text AS net FROM project.project_ra_bills WHERE tenant_id = ${TENANT} AND id = ${res.json().id}`);
    expect(r?.net).toBe("180000");
  });

  it("POST time-extensions -> 202 and stored", async () => {
    const res = await post("/time-extensions", { originalEndDate: "2026-12-31", extendedEndDate: "2027-01-30", extensionDays: 30, reason: "g4", penaltyApplicable: true, penaltyPerDayMinor: 1000 });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const [r] = await rows(sql`SELECT penalty_per_day_minor::text AS p FROM project.project_time_extensions WHERE tenant_id = ${TENANT} AND id = ${res.json().id}`);
    expect(r?.p).toBe("1000");
  });

  it("POST penalties -> 202 and total = days x rate, in paise", async () => {
    const res = await post("/penalties", { penaltyType: "quality", fromDate: "2026-05-01", toDate: "2026-05-11", days: 10, ratePerDayMinor: 2500 });
    expect(res.statusCode).toBe(202);
    expect(res.json().totalMinor).toBe("25000");
    expect(await drain()).toHaveLength(0);
    const [r] = await rows(sql`SELECT total_minor::text AS t FROM project.project_penalties WHERE tenant_id = ${TENANT} AND id = ${res.json().id}`);
    expect(r?.t).toBe("25000");
  });

  it("POST resources -> 202 and stored", async () => {
    const res = await post("/resources", { resourceType: "equipment", resourceName: "G4 crane", allocatedHours: 12.5, dailyRateMinor: 7500, fromDate: "2026-04-01", toDate: "2026-04-30" });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const [r] = await rows(sql`SELECT daily_rate_minor::text AS d FROM project.project_resources WHERE tenant_id = ${TENANT} AND id = ${res.json().id}`);
    expect(r?.d).toBe("7500");
  });
});

describe("PATCH /risks/:riskId is now applied (was dropped)", () => {
  it("updates fields and recomputes risk_score", async () => {
    const created = await post("/risks", { title: "G4 risk", probability: "low", impact: "low" });
    expect(created.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const riskId = created.json().id as string;

    const res = await app.inject({
      method: "PATCH", url: `/v1/projects/${PROJECT}/risks/${riskId}`, headers: headers(),
      payload: { status: "mitigated", probability: "high", title: "G4 risk renamed" },
    });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const [r] = await rows(sql`SELECT title, status, probability, impact, risk_score FROM project.project_risks WHERE id = ${riskId} AND tenant_id = ${TENANT}`);
    expect(r).toMatchObject({ title: "G4 risk renamed", status: "mitigated", probability: "high", impact: "low", risk_score: 3 });
  });
});

describe("PATCH /projects/:id bumps version", () => {
  it("version 1 -> 2 after the consumer applies the update", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/projects/${PROJECT}`, headers: headers(), payload: { name: "G4 renamed" } });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const [r] = await rows(sql`SELECT name, version FROM project.project_projects WHERE id = ${PROJECT} AND tenant_id = ${TENANT}`);
    expect(r).toMatchObject({ name: "G4 renamed", version: 2 });
  });
});

describe("baselines + EVM reads", () => {
  it("POST baselines is stored, GET lists it", async () => {
    const res = await post("/baselines", { label: "G4 baseline", snapshotData: { k: "v" } });
    expect(res.statusCode).toBe(202);
    expect(await drain()).toHaveLength(0);
    const list = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT}/baselines`, headers: headers() });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
  });

  it("GET baselines / evm of an unknown project is a 4xx/200, never a 500 (table shape repaired)", async () => {
    const list = await app.inject({ method: "GET", url: `/v1/projects/${MISSING}/baselines`, headers: headers() });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);
    const evm = await app.inject({ method: "GET", url: `/v1/projects/${MISSING}/evm`, headers: headers() });
    expect(evm.statusCode).toBe(422);
    expect(evm.json().code).toBe("BASELINE_REQUIRED");
  });
});

describe("route-level validation is a 400 (error handler registered before routes)", () => {
  it("GET /v1/projects/not-a-uuid/tasks -> 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects/not-a-uuid/tasks", headers: headers() });
    expect(res.statusCode).toBe(400);
  });
});
