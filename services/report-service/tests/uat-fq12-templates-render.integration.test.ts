/**
 * Real-DB regression for UAT FQ12 report-service defects:
 *
 *  #59 #60 #61 #63 — POST/PATCH/DELETE/execute on /v1/reports/templates returned
 *  202 but nothing subscribed to reports.template.*, so no row was ever written
 *  (and the create projection's ISO-string timestamps would have broken the
 *  insert even if it had been). The worker now registers the template consumers.
 *
 *  #62 — the render consumer marked the job 'running', which violates
 *  jobs_status_check (queued/processing/completed/failed); the tx rolled back
 *  and every job ended 'failed'. It now writes 'processing'.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";

const storage = vi.hoisted(() => ({ statusDuringUpload: [] as string[], probe: null as null | ((jobId: string) => Promise<string>) }));
// Storage is the only external dependency of the render path; capture the job's
// persisted status at upload time (i.e. after the "mark in progress" tx committed).
vi.mock("@civitasone/storage", () => ({
  putObject: async (key: string) => {
    const jobId = key.split("/").pop()!.split(".")[0]!;
    if (storage.probe) storage.statusDuringUpload.push(await storage.probe(jobId));
  },
  presignedGetUrl: async () => "https://storage.invalid/signed",
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { jobs } from "../src/modules/jobs/schema.js";
import { reportTemplates } from "../src/modules/templates/schema.js";
import { registerTemplateConsumers } from "../src/modules/templates/consumer.js";
import { registerRenderConsumers } from "../src/modules/render/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["report_admin"] }, SECRET, 3600)}` };

let app: FastifyInstance;

async function until<T>(fn: () => Promise<T | undefined | null | false>): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not met in time");
}

const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

async function templateRow(id: string) {
  const rows = await asTenant((tx) => tx.select().from(reportTemplates).where(eq(reportTemplates.id, id)));
  return rows[0] ?? null;
}
async function jobRow(id: string) {
  const rows = await asTenant((tx) => tx.select().from(jobs).where(eq(jobs.id, id)));
  return rows[0] ?? null;
}

beforeAll(async () => {
  storage.probe = async (jobId) => (await jobRow(jobId))?.status ?? "missing";
  app = await buildApp();
  registerTemplateConsumers(queue);
  registerRenderConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("UAT FQ12 #59-#63 report templates are persisted by a subscribed consumer", () => {
  it("create -> update -> execute -> delete each take effect", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: auth,
      payload: { name: "FQ12 tpl", dataSourceId: "finance.budget", outputFormat: "csv" },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().data?.id ?? create.json().id;

    // #59: the row exists (timestamps defaulted by the DB, actor from the envelope).
    const created = await until(() => templateRow(id));
    expect(created.name).toBe("FQ12 tpl");
    expect(created.tenantId).toBe(TENANT);
    expect(created.createdBy).toBe(ACTOR);
    expect(created.createdAt).toBeInstanceOf(Date);

    // #60: update bumps the version.
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/reports/templates/${id}`,
      headers: auth,
      payload: { version: 1, name: "FQ12 tpl v2" },
    });
    expect(patch.statusCode).toBe(202);
    const updated = await until(async () => {
      const r = await templateRow(id);
      return r && r.version === 2 ? r : null;
    });
    expect(updated.name).toBe("FQ12 tpl v2");

    // #61: execute creates the report job under the returned id and queues its render.
    const exec = await app.inject({
      method: "POST",
      url: `/v1/reports/templates/${id}/execute`,
      headers: auth,
      payload: { parameters: { period: "2026-10", ward: 7 } },
    });
    expect(exec.statusCode).toBe(202);
    const jobId = exec.json().data?.id ?? exec.json().id;
    const job = await until(() => jobRow(jobId));
    expect(job.name).toBe("FQ12 tpl v2");
    expect(job.format).toBe("csv");
    expect(job.requestedBy).toBe(ACTOR);
    expect(job.parameters).toEqual({ period: "2026-10", ward: "7" });
    const renders = await asTenant((tx) => tx.execute(
      sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE topic = ${COMMANDS.renderJob} AND payload->>'jobId' = ${jobId}`,
    )) as unknown as Array<{ n: number }>;
    expect(renders[0]!.n).toBe(1);

    // #63: delete archives the template.
    const del = await app.inject({ method: "DELETE", url: `/v1/reports/templates/${id}`, headers: auth });
    expect(del.statusCode).toBe(202);
    const archived = await until(async () => {
      const r = await templateRow(id);
      return r && r.status === "archived" ? r : null;
    });
    expect(archived.status).toBe("archived");
  });
});

describe("UAT FQ12 #62 render marks the job with a status the CHECK constraint allows", () => {
  it("job moves queued -> processing -> completed, never failed", async () => {
    const jobId = randomUUID();
    await asTenant((tx) => tx.insert(jobs).values({
      id: jobId, tenantId: TENANT, name: "FQ12 render", status: "queued", format: "csv",
      createdBy: ACTOR, updatedBy: ACTOR,
    }));

    await queue.publish(COMMANDS.renderJob, {
      messageId: randomUUID(),
      type: COMMANDS.renderJob,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        jobId, tenantId: TENANT, templateHtml: "<p>x</p>", format: "csv",
        columns: [{ header: "Ward", key: "ward" }], rows: [{ ward: "7" }],
      },
    });

    const done = await until(async () => {
      const r = await jobRow(jobId);
      return r && (r.status === "completed" || r.status === "failed") ? r : null;
    });
    expect(done.status).toBe("completed");
    expect(storage.statusDuringUpload).toContain("processing");

    const failed = await asTenant((tx) => tx.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "failed"))));
    expect(failed).toHaveLength(0);
  });
});
