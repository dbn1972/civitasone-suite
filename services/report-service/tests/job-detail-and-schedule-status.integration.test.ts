/**
 * Real-DB regression tests for two report-service read-model defects:
 *
 *  1. GET /v1/reports/report-jobs/:id always returned columns [], rows [] and no
 *     parameters -- nothing was stored. Parameters are now persisted at create time
 *     and the render pipeline stores a bounded (PII-masked) result preview.
 *  2. GET /v1/reports/scheduled only listed ENABLED schedules, so a disabled one
 *     vanished from the screen and could not be re-enabled. It now lists every
 *     non-deleted schedule with its status; DELETE hides, PATCH {enabled:true}
 *     re-enables (restarting the cadence from now).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { jobs } from "../src/modules/jobs/schema.js";
import { registerJobConsumers } from "../src/modules/jobs/consumer.js";
import { registerScheduledConsumers } from "../src/modules/scheduled/consumer.js";
import { buildResultPreview, RESULT_PREVIEW_ROWS } from "../src/modules/render/consumer.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["report_admin"] }, SECRET, 3600)}` };

let app: FastifyInstance;

async function until<T>(fn: () => Promise<T | undefined | false>): Promise<T> {
  for (let i = 0; i < 80; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not met in time");
}

type Sched = { id: string; enabled: boolean; status: string; version: number; nextRunAt: string };
async function listScheduled(): Promise<{ data: Sched[]; meta: { total: number } }> {
  const res = await app.inject({ method: "GET", url: "/v1/reports/scheduled", headers: auth });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeAll(async () => {
  app = await buildApp();
  registerJobConsumers(queue);
  registerScheduledConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("report job detail", () => {
  it("returns the stored parameters and result preview (not hard-coded empty arrays)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/reports/jobs",
      headers: auth,
      payload: { name: "Collections", reportType: "revenue", parameters: { period: "2026-09", ward: "7" } },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id as string;

    // Parameters are persisted by the create consumer.
    const fresh = await until(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/reports/report-jobs/${id}`, headers: auth });
      return r.statusCode === 200 ? (r.json() as { parameters?: Record<string, string> }) : false;
    });
    expect(fresh.parameters).toEqual({ period: "2026-09", ward: "7" });

    // The render pipeline stores columns/rows on completion; simulate that write.
    await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.update(jobs).set({
          status: "completed",
          rowCount: 1500,
          resultColumns: ["ward", "amount"],
          resultRows: [{ ward: "7", amount: "1200" }, { ward: "8", amount: "900" }],
        }).where(eq(jobs.id, id)),
      ),
    );
    const res = await app.inject({ method: "GET", url: `/v1/reports/report-jobs/${id}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.columns).toEqual(["ward", "amount"]);
    expect(body.rows).toEqual([{ ward: "7", amount: "1200" }, { ward: "8", amount: "900" }]);
    // totalCount is the real row count, not the preview length.
    expect(body.totalCount).toBe(1500);
  });

  it("rejects an oversized parameters object", async () => {
    const parameters = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    const res = await app.inject({ method: "POST", url: "/v1/reports/jobs", headers: auth, payload: { name: "x", parameters } });
    expect(res.statusCode).toBe(400);
  });
});

describe("buildResultPreview", () => {
  it("keys rows by the declared columns, stringifies cells and caps the preview", () => {
    const rows = Array.from({ length: RESULT_PREVIEW_ROWS + 5 }, (_, i) => ({ n: i, note: null, extra: "dropped" }));
    const out = buildResultPreview([{ key: "n" }, { key: "note" }], rows);
    expect(out.resultColumns).toEqual(["n", "note"]);
    expect(out.resultRows).toHaveLength(RESULT_PREVIEW_ROWS);
    expect(out.resultRows[3]).toEqual({ n: "3", note: "" });
  });
  it("falls back to the first row's keys when no columns are declared", () => {
    expect(buildResultPreview(undefined, [{ a: 1, b: { c: 2 } }])).toEqual({
      resultColumns: ["a", "b"],
      resultRows: [{ a: "1", b: JSON.stringify({ c: 2 }) }],
    });
  });
});

describe("scheduled report list", () => {
  it("lists a disabled schedule with its status, allows re-enable, and hides only deleted ones", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/reports/scheduled",
      headers: auth,
      payload: { templateId: randomUUID(), cadence: "weekly", recipients: ["ops@example.gov.in"], format: "pdf" },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().data.id as string;
    const active = await until(async () => (await listScheduled()).data.find((s) => s.id === id && s.version === 1));
    expect(active.status).toBe("active");

    // Disable: the row must stay visible, flagged disabled.
    const dis = await app.inject({ method: "PATCH", url: `/v1/reports/scheduled/${id}`, headers: auth, payload: { enabled: false, version: 1 } });
    expect(dis.statusCode).toBe(202);
    const disabled = await until(async () => (await listScheduled()).data.find((s) => s.id === id && !s.enabled));
    expect(disabled.status).toBe("disabled");
    expect((await listScheduled()).meta.total).toBe(1);

    // Re-enable: back to active, cadence restarted from now (not the stale pre-disable time).
    const before = Date.now();
    const en = await app.inject({ method: "PATCH", url: `/v1/reports/scheduled/${id}`, headers: auth, payload: { enabled: true, version: disabled.version } });
    expect(en.statusCode).toBe(202);
    const reenabled = await until(async () => (await listScheduled()).data.find((s) => s.id === id && s.enabled));
    expect(reenabled.status).toBe("active");
    expect(new Date(reenabled.nextRunAt).getTime()).toBeGreaterThan(before);

    // Delete: hidden from the list and from GET :id (a deleted schedule is not a disabled one).
    const del = await app.inject({ method: "DELETE", url: `/v1/reports/scheduled/${id}`, headers: auth });
    expect(del.statusCode).toBe(202);
    await until(async () => (await listScheduled()).data.every((s) => s.id !== id));
    expect((await listScheduled()).meta.total).toBe(0);
    const get = await app.inject({ method: "GET", url: `/v1/reports/scheduled/${id}`, headers: auth });
    expect(get.statusCode).toBe(404);
  });
});
