/**
 * WC-009 — sandbox masked-refresh consumer tests.
 *
 * Proves the three things a consumer in this repo must get right:
 *   1. IDEMPOTENCY — the same messageId processed twice writes exactly once,
 *      and it is `markProcessed` doing the gating (re-armed job, same id → still
 *      one write).
 *   2. NO DOUBLE-WRITE with the route — the approve route wrote the approval
 *      columns; the consumer writes only the later facts.
 *   3. It moves NO DATA: `dataMovement` stays `stubbed`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_sandbox_Consumers } = await import("../src/modules/sandbox/f3-consumer.js");
const { handleSandboxRefreshExecute } = await import("../src/modules/sandbox/consumer.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "5c000000-0000-4000-8000-0000000000c1";
const MAKER = "5c111111-0000-4000-8000-000000000001";
const CHECKER = "5c222222-0000-4000-8000-000000000002";

function auth(actorId: string): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub: actorId, tid: TENANT, roles: ["tenant_admin"], sid: "s" }, SECRET, 3600)}` };
}

function asTenant<T>(run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  await asTenant(async (sql) => {
    await sql`DELETE FROM sandbox.refresh_masked_fields WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM sandbox.refresh_jobs WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM sandbox.masking_rules WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM sandbox.sandbox_environments WHERE tenant_id = ${TENANT}`;
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  // WC-009's register/masking-rule/refresh/approve/reject routes were all
  // converted to F3 async (202 accepted) — the apply_sandbox_N functions
  // that actually write are only ever invoked by the consumer registered in
  // src/worker.ts (a process this test never runs). Without registering it
  // here, every write returns 202 and is NEVER applied. Registered against
  // the real in-memory test Queue singleton buildApp() wires the routes
  // through, tenantScoped like worker.ts does (see
  // tests/helpers/register-all-f3-consumers.ts) — same pattern as
  // tests/central-config.test.ts. This is a SEPARATE consumer from
  // handleSandboxRefreshExecute below: that one is invoked directly in this
  // file's tests, so registerSandboxConsumers (the bare-queue subscriber for
  // admin.sandbox_refresh.execute) is deliberately NOT registered here.
  registerF3_sandbox_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

interface SingleBody<T> { data: T }
interface Sandbox { id: string; status: string; version: number }
interface Job { id: string; version: number; status: string }

let seq = 0;

/**
 * Registers a sandbox via the (now async) route, lands the write, and
 * returns the REAL persisted row.
 *
 * sandbox/f3-apply.ts's apply_sandbox_0 never forwards the route-generated
 * id into repo.insertSandbox() — the DB assigns its own id (schema default),
 * so the id echoed in the 202 response does NOT match the persisted row.
 * Same class of bug already documented in tests/central-config.test.ts and
 * tests/integration-ops.test.ts for other modules (real, pre-existing, out
 * of this batch's scope) — worked around the same way: look the real row up
 * by its unique business key (`code`) instead of trusting the echoed id.
 */
async function registerSandbox(code: string, name: string, sourceEnvironment: string): Promise<Sandbox> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/sandboxes", headers: auth(MAKER),
    payload: { code, name, sourceEnvironment },
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  const rows = await asTenant((sql) => sql<Sandbox[]>`
    SELECT id, status, version FROM sandbox.sandbox_environments
    WHERE tenant_id = ${TENANT} AND code = ${code}`);
  const found = rows[0];
  if (!found) throw new Error(`sandbox with code '${code}' never landed`);
  return found;
}

/**
 * Requests a masked refresh via the (now async) route, lands the write, and
 * returns the REAL persisted job row.
 *
 * apply_sandbox_2 (insertRefreshJob) has the same id-forwarding bug as
 * apply_sandbox_0 above — look the real job up by sandboxId instead of
 * trusting the echoed id. The newest row for this sandbox is unambiguous
 * because each caller here creates exactly one refresh job per sandbox.
 */
async function requestRefresh(
  sandboxId: string,
  fields: Array<{ tableName: string; fieldName: string }>,
): Promise<Job> {
  const res = await app.inject({
    method: "POST", url: `/v1/admin/sandboxes/${sandboxId}/refreshes`, headers: auth(MAKER),
    payload: { requestedFields: fields },
  });
  expect(res.statusCode).toBe(202);
  await (queue as any).drain?.();
  const rows = await asTenant((sql) => sql<Job[]>`
    SELECT id, status, version FROM sandbox.refresh_jobs
    WHERE tenant_id = ${TENANT} AND sandbox_id = ${sandboxId}
    ORDER BY created_at DESC LIMIT 1`);
  const found = rows[0];
  if (!found) throw new Error(`refresh job for sandbox '${sandboxId}' never landed`);
  return found;
}

/** Register a sandbox, add rules, request a refresh and approve it → queued. */
async function queuedJob(
  rules: Array<[string, string, string, string]>,
  fields: Array<{ tableName: string; fieldName: string }>,
): Promise<{ sandbox: Sandbox; job: Job }> {
  seq += 1;
  const sandbox = await registerSandbox(`csm-${seq}`, `Consumer ${seq}`, "production");

  for (const [tableName, fieldName, strategy, justification] of rules) {
    const r = await app.inject({
      method: "POST", url: `/v1/admin/sandboxes/${sandbox.id}/masking-rules`, headers: auth(MAKER),
      payload: { tableName, fieldName, strategy, justification },
    });
    expect(r.statusCode).toBe(202);
  }
  if (rules.length > 0) await (queue as any).drain?.();

  const job = await requestRefresh(sandbox.id, fields);

  const app2 = await app.inject({
    method: "POST", url: `/v1/admin/sandbox-refreshes/${job.id}/approve`, headers: auth(CHECKER),
    payload: { expectedVersion: job.version },
  });
  expect(app2.statusCode).toBe(202);
  await (queue as any).drain?.();
  // apply_sandbox_3 (approve) updates the EXISTING job row in place — it
  // looks the row up by the id already in the URL and never inserts a new
  // one, so it does NOT have the id-forwarding bug above. Re-reading the row
  // gives the true post-approve state instead of hand-computing
  // version + 1 / status "queued" client-side against a write that, now
  // async, may not have landed yet.
  const after = await jobRow(job.id);
  if (!after) throw new Error(`approved refresh job '${job.id}' vanished`);
  return { sandbox, job: { id: job.id, version: after.version, status: after.status } };
}

function message(jobId: string, sandboxId: string, messageId = randomUUID()): {
  messageId: string; tenantId: string; actorId: string; correlationId: string;
  payload: { jobId: string; sandboxId: string; tenantId: string };
} {
  return {
    messageId,
    tenantId: TENANT,
    actorId: CHECKER,
    correlationId: `corr-${messageId}`,
    payload: { jobId, sandboxId, tenantId: TENANT },
  };
}

function maskedCount(jobId: string): Promise<number> {
  return asTenant(async (sql) => {
    const rows = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM sandbox.refresh_masked_fields WHERE job_id = ${jobId}`;
    return rows[0]?.n ?? 0;
  });
}

interface JobRow {
  status: string;
  version: number;
  data_movement: string;
  masked_field_count: number;
  preserved_field_count: number;
  /** postgres.js hands timestamptz back as a Date or an ISO string. */
  started_at: Date | string | null;
  completed_at: Date | string | null;
  approved_by: string | null;
}

function jobRow(jobId: string): Promise<JobRow | undefined> {
  return asTenant(async (sql) => {
    const rows = await sql<JobRow[]>`
      SELECT status, version, data_movement, masked_field_count, preserved_field_count,
             started_at, completed_at, approved_by
      FROM sandbox.refresh_jobs WHERE id = ${jobId}`;
    return rows[0];
  });
}

/** Compare timestamps without depending on the driver's Date-vs-string choice. */
function stamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

describe("sandbox refresh consumer — happy path", () => {
  it("closes the job, records the fail-closed plan and never moves data", async () => {
    const { sandbox, job } = await queuedJob(
      [["citizens", "email", "hash", ""], ["citizens", "district", "preserve", "public reference data"]],
      [
        { tableName: "citizens", fieldName: "email" },
        { tableName: "citizens", fieldName: "district" },
        { tableName: "citizens", fieldName: "aadhaar" },
      ],
    );

    await handleSandboxRefreshExecute(message(job.id, sandbox.id));

    const row = await jobRow(job.id);
    expect(row?.status).toBe("completed");
    expect(row?.data_movement).toBe("stubbed");
    expect(row?.masked_field_count).toBe(2);
    expect(row?.preserved_field_count).toBe(1);
    expect(row?.started_at).not.toBeNull();
    expect(row?.completed_at).not.toBeNull();

    const recorded = await asTenant((sql) => sql<Array<{ field_name: string; strategy: string; rule_source: string }>>`
      SELECT field_name, strategy, rule_source FROM sandbox.refresh_masked_fields
      WHERE job_id = ${job.id} ORDER BY field_name`);
    expect(recorded).toHaveLength(3);
    expect(recorded.find((r) => r.field_name === "aadhaar")).toMatchObject({ strategy: "redact", rule_source: "default" });
    expect(recorded.find((r) => r.field_name === "email")).toMatchObject({ strategy: "hash", rule_source: "rule" });
    expect(recorded.find((r) => r.field_name === "district")).toMatchObject({ strategy: "preserve", rule_source: "rule" });
  });

  it("flips the sandbox to ready and stamps lastRefreshAt", async () => {
    const { sandbox, job } = await queuedJob([], [{ tableName: "t", fieldName: "f" }]);
    await handleSandboxRefreshExecute(message(job.id, sandbox.id));
    const rows = await asTenant((sql) => sql<Array<{ status: string; last_refresh_at: Date | null }>>`
      SELECT status, last_refresh_at FROM sandbox.sandbox_environments WHERE id = ${sandbox.id}`);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.last_refresh_at).not.toBeNull();
  });

  it("publishes the completion event and an audit record on the outbox", async () => {
    const { sandbox, job } = await queuedJob([], [{ tableName: "t", fieldName: "f" }]);
    await handleSandboxRefreshExecute(message(job.id, sandbox.id));
    const events = await asTenant((sql) => sql<Array<{ topic: string }>>`
      SELECT topic FROM _outbox.messages WHERE payload->>'jobId' = ${job.id} ORDER BY topic`);
    expect(events.map((r) => r.topic)).toContain("admin.sandbox_refresh.completed");

    // The audit record addresses the job through resourceId, not jobId.
    const audits = await asTenant((sql) => sql<Array<{ action: string }>>`
      SELECT payload->>'action' AS action FROM _outbox.messages
      WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${job.id}`);
    expect(audits.map((r) => r.action)).toContain("sandbox_refresh.completed");
  });

  it("does NOT re-write the approval columns the route already wrote", async () => {
    const { sandbox, job } = await queuedJob([], [{ tableName: "t", fieldName: "f" }]);
    const before = await jobRow(job.id);
    await handleSandboxRefreshExecute(message(job.id, sandbox.id));
    const after = await jobRow(job.id);
    // approvedBy was set by the route and is untouched by the consumer.
    expect(after?.approved_by).toBe(before?.approved_by);
    expect(after?.approved_by).toBe(CHECKER);
  });
});

describe("sandbox refresh consumer — idempotency", () => {
  it("processing the SAME messageId twice writes the masked-field rows once", async () => {
    const { sandbox, job } = await queuedJob([], [
      { tableName: "t", fieldName: "a" },
      { tableName: "t", fieldName: "b" },
    ]);
    const msg = message(job.id, sandbox.id);

    await handleSandboxRefreshExecute(msg);
    expect(await maskedCount(job.id)).toBe(2);
    const first = await jobRow(job.id);

    await handleSandboxRefreshExecute(msg);
    expect(await maskedCount(job.id)).toBe(2);
    const second = await jobRow(job.id);
    expect(second?.version).toBe(first?.version);
    expect(stamp(second?.completed_at)).toBe(stamp(first?.completed_at));
  });

  it("markProcessed is what stops the replay: re-arming the job changes nothing", async () => {
    const { sandbox, job } = await queuedJob([], [{ tableName: "t", fieldName: "a" }]);
    const msg = message(job.id, sandbox.id);
    await handleSandboxRefreshExecute(msg);
    expect(await maskedCount(job.id)).toBe(1);

    // Put the job back to `queued` so the status guard would NOT stop a replay.
    // Only the inbox record can now prevent a second write.
    await asTenant((sql) => sql`
      UPDATE sandbox.refresh_jobs SET status = 'queued' WHERE id = ${job.id}`);
    await handleSandboxRefreshExecute(msg);

    expect(await maskedCount(job.id)).toBe(1);
    expect((await jobRow(job.id))?.status).toBe("queued");
  });

  it("a DIFFERENT messageId for a re-armed job does process again — the guard is per message", async () => {
    const { sandbox, job } = await queuedJob([], [{ tableName: "t", fieldName: "a" }]);
    await handleSandboxRefreshExecute(message(job.id, sandbox.id));
    expect(await maskedCount(job.id)).toBe(1);

    await asTenant((sql) => sql`
      UPDATE sandbox.refresh_jobs SET status = 'queued' WHERE id = ${job.id}`);
    await handleSandboxRefreshExecute(message(job.id, sandbox.id));
    expect(await maskedCount(job.id)).toBe(2);
    expect((await jobRow(job.id))?.status).toBe("completed");
  });

  it("records the message in the inbox so the relay can safely re-publish", async () => {
    const { sandbox, job } = await queuedJob([], [{ tableName: "t", fieldName: "a" }]);
    const msg = message(job.id, sandbox.id);
    await handleSandboxRefreshExecute(msg);
    const rows = await sqlClient<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM _inbox.processed WHERE message_id = ${msg.messageId}`;
    expect(rows[0]?.n).toBe(1);
  });
});

describe("sandbox refresh consumer — skip and failure paths", () => {
  it("skips silently when the job no longer exists", async () => {
    const msg = message(randomUUID(), randomUUID());
    await expect(handleSandboxRefreshExecute(msg)).resolves.toBeUndefined();
    expect(await maskedCount(msg.payload.jobId)).toBe(0);
  });

  it("skips a job that is not queued (still awaiting approval)", async () => {
    seq += 1;
    const sandbox = await registerSandbox(`csm-pending-${seq}`, "Pending", "dev");
    const job = await requestRefresh(sandbox.id, [{ tableName: "t", fieldName: "f" }]);

    await handleSandboxRefreshExecute(message(job.id, sandbox.id));

    expect(await maskedCount(job.id)).toBe(0);
    expect((await jobRow(job.id))?.status).toBe("pending_approval");
  });

  it("never throws out of the handler, so a bad message cannot kill the worker loop", async () => {
    const bad = {
      messageId: randomUUID(),
      tenantId: "not-a-uuid",
      actorId: CHECKER,
      correlationId: "corr-bad",
      payload: { jobId: randomUUID(), sandboxId: randomUUID(), tenantId: "not-a-uuid" },
    };
    await expect(handleSandboxRefreshExecute(bad)).resolves.toBeUndefined();
  });

  it("aborts the WHOLE transaction on a concurrent version conflict — no half-applied job", async () => {
    const { sandbox, job } = await queuedJob([], [
      { tableName: "t", fieldName: "a" },
      { tableName: "t", fieldName: "b" },
    ]);
    // Two deliveries with DIFFERENT message ids, so the inbox guard lets both in
    // and only the optimistic lock on the job can arbitrate. The loser's
    // masked-field inserts must roll back with its failed UPDATE.
    await Promise.all([
      handleSandboxRefreshExecute(message(job.id, sandbox.id)),
      handleSandboxRefreshExecute(message(job.id, sandbox.id)),
    ]);
    expect(await maskedCount(job.id)).toBe(2);
    const row = await jobRow(job.id);
    expect(row?.status).toBe("completed");
    expect(row?.masked_field_count).toBe(2);
  });

  it("plans zero fields when the job requested none, and still completes", async () => {
    seq += 1;
    const sandbox = await registerSandbox(`csm-zero-${seq}`, "Zero", "dev");
    // The route enforces >= 1 requested field, so an empty list can only arrive
    // on a row written before that rule existed. Simulate that legacy row.
    const inserted = await asTenant((sql) => sql<Array<{ id: string }>>`
      INSERT INTO sandbox.refresh_jobs
        (tenant_id, sandbox_id, source_environment, requested_fields, status,
         requested_by, data_movement, created_by, updated_by)
      VALUES (${TENANT}, ${sandbox.id}, 'dev', '[]'::jsonb, 'queued',
              ${MAKER}, 'stubbed', ${MAKER}, ${MAKER})
      RETURNING id`);
    const jobId = inserted[0]?.id ?? "";
    expect(jobId).not.toBe("");

    await handleSandboxRefreshExecute(message(jobId, sandbox.id));
    const row = await jobRow(jobId);
    expect(row?.status).toBe("completed");
    expect(row?.masked_field_count).toBe(0);
    expect(row?.preserved_field_count).toBe(0);
    expect(await maskedCount(jobId)).toBe(0);
  });
});

describe("registerSandboxConsumers", () => {
  it("subscribes the handler to the command topic the approve route publishes", async () => {
    const { registerSandboxConsumers } = await import("../src/modules/sandbox/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const subscribed: string[] = [];
    const stubQueue = {
      publish: async () => "id",
      subscribe: (topic: string) => { subscribed.push(topic); },
      start: async () => undefined,
      stop: async () => undefined,
      healthCheck: async () => ({ healthy: true, driver: "memory" as const }),
    };
    registerSandboxConsumers(stubQueue as unknown as Parameters<typeof registerSandboxConsumers>[0]);

    expect(subscribed).toEqual([COMMANDS.sandboxRefreshExecute]);
    expect(COMMANDS.sandboxRefreshExecute).toBe("admin.sandbox_refresh.execute");
  });

  it("the subscribed handler forwards a bus message to the execute handler", async () => {
    const { registerSandboxConsumers } = await import("../src/modules/sandbox/consumer.js");
    type Handler = (msg: unknown) => Promise<void>;
    let captured: Handler | undefined;
    const stubQueue = {
      publish: async () => "id",
      subscribe: (_topic: string, handler: Handler) => { captured = handler; },
      start: async () => undefined,
      stop: async () => undefined,
      healthCheck: async () => ({ healthy: true, driver: "memory" as const }),
    };
    registerSandboxConsumers(stubQueue as unknown as Parameters<typeof registerSandboxConsumers>[0]);
    expect(captured).toBeDefined();

    const { sandbox, job } = await queuedJob([], [{ tableName: "t", fieldName: "a" }]);
    await captured?.(message(job.id, sandbox.id));
    expect((await jobRow(job.id))?.status).toBe("completed");
  });
});
