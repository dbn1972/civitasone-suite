/**
 * GAP-INSTALL-DOMAIN-PACKS-01 / -04 (owner decision #28): install-service keeps a durable
 * per-tenant domain-pack activation record, consumes citizen-service's completion event to move it
 * (and the Stage 3 row) to completed/failed, and serves it from a status endpoint so a reload shows
 * the activated state. Real DB, real consumers, memory queue.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerStageConsumers } from "../src/modules/stages/consumer.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const COMPLETED_TOPIC = "citizen.pack.domain_activated";
const STATUS_URL = "/v1/install/stages/3/domain-pack/status";

const headers = (tenant = TENANT, roles = ["install_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles }, SECRET, 3600)}`,
});

let app: FastifyInstance;

type Activation = {
  id: string; status: string; stageId: string; domainPackKey: string; draftIds: string[];
  failureReason?: string | null; completedAt?: string | null;
};
type StatusBody = { activation: Activation | null };

async function status(tenant = TENANT, key = "municipal-in-v1", roles?: string[]): Promise<{ code: number; body: StatusBody }> {
  const res = await app.inject({ method: "GET", url: `${STATUS_URL}?domainPackKey=${key}`, headers: headers(tenant, roles) });
  return { code: res.statusCode, body: res.json() as StatusBody };
}

async function until<T>(fn: () => Promise<T | undefined>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not reached in time");
}

async function activate(tenant = TENANT): Promise<{ id: string; stageId: string }> {
  const res = await app.inject({
    method: "POST", url: "/v1/install/stages/3/domain-pack/activate",
    headers: headers(tenant), payload: { domainPackKey: "municipal-in-v1" },
  });
  expect(res.statusCode).toBe(202);
  return res.json() as { id: string; stageId: string };
}

function publishCompleted(tenant: string, p: { activationId: string; stageId: string; outcome: string; draftIds?: string[]; reason?: string }, messageId = randomUUID()) {
  return queue.publish(COMPLETED_TOPIC, {
    messageId, type: COMPLETED_TOPIC, tenantId: tenant, actorId: ACTOR, correlationId: "corr-citizen", schemaVersion: "1.0",
    payload: { domainPackKey: "municipal-in-v1", draftIds: [], ...p },
  });
}

async function stepStatus(stageId: string, tenant = TENANT) {
  const res = await app.inject({ method: "GET", url: "/v1/install/steps", headers: headers(tenant) });
  return (res.json() as Array<{ id: string; status: string; errorMessage?: string }>).find((s) => s.id === stageId);
}

beforeAll(async () => {
  app = await buildApp();
  registerStageConsumers(queue);
  await queue.start();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("domain-pack activation record + status endpoint (owner decision #28)", () => {
  it("no activation yet: status is an explicit null, not an error", async () => {
    const { code, body } = await status();
    expect(code).toBe(200);
    expect(body.activation).toBeNull();
  });

  it("activating writes a durable record the status endpoint serves (accepted, with stage id)", async () => {
    const accepted = await activate();
    const rec = await until(async () => (await status()).body.activation ?? undefined);
    expect(rec).toMatchObject({ id: accepted.id, stageId: accepted.stageId, status: "accepted", domainPackKey: "municipal-in-v1" });
  });

  it("citizen completed event -> record completed with draft ids AND the Stage 3 row completed", async () => {
    const { id, stageId } = await activate();
    await until(async () => ((await status()).body.activation?.id === id ? true : undefined));
    const drafts = [randomUUID(), randomUUID(), randomUUID()];
    await publishCompleted(TENANT, { activationId: id, stageId, outcome: "completed", draftIds: drafts });
    const rec = await until(async () => { const a = (await status()).body.activation; return a?.status === "completed" ? a : undefined; });
    expect(rec.draftIds).toEqual(drafts);
    expect(rec.completedAt).toBeTruthy();
    expect((await until(async () => { const s = await stepStatus(stageId); return s?.status === "completed" ? s : undefined; })).status).toBe("completed");
  });

  it("citizen failed event -> record failed with a reason AND the Stage 3 row failed with its message", async () => {
    const { id, stageId } = await activate();
    await until(async () => ((await status()).body.activation?.id === id ? true : undefined));
    await publishCompleted(TENANT, { activationId: id, stageId, outcome: "failed", reason: "no_drafts_imported" });
    const rec = await until(async () => { const a = (await status()).body.activation; return a?.status === "failed" ? a : undefined; });
    expect(rec.failureReason).toBe("no_drafts_imported");
    const step = await until(async () => { const s = await stepStatus(stageId); return s?.status === "failed" ? s : undefined; });
    expect(step.errorMessage).toBe("no_drafts_imported");
  });

  it("a redelivered completion event does not re-apply, and a stale event cannot move a terminal record", async () => {
    const { id, stageId } = await activate();
    await until(async () => ((await status()).body.activation?.id === id ? true : undefined));
    const mid = randomUUID();
    await publishCompleted(TENANT, { activationId: id, stageId, outcome: "completed", draftIds: [randomUUID()] }, mid);
    await until(async () => ((await status()).body.activation?.status === "completed" ? true : undefined));
    await publishCompleted(TENANT, { activationId: id, stageId, outcome: "completed", draftIds: [randomUUID()] }, mid);
    await publishCompleted(TENANT, { activationId: id, stageId, outcome: "failed", reason: "late" });
    await new Promise((r) => setTimeout(r, 800));
    const rec = (await status()).body.activation!;
    expect(rec.status).toBe("completed");
    expect(rec.draftIds).toHaveLength(1);
  });

  it("is tenant-scoped: another tenant sees no activation and cannot complete this one", async () => {
    const { id, stageId } = await activate();
    await until(async () => ((await status()).body.activation?.id === id ? true : undefined));
    expect((await status(OTHER_TENANT)).body.activation).toBeNull();
    await publishCompleted(OTHER_TENANT, { activationId: id, stageId, outcome: "completed", draftIds: [randomUUID()] });
    await new Promise((r) => setTimeout(r, 800));
    expect((await status()).body.activation?.status).toBe("accepted");
  });

  it("reads: install_user may read; unauthenticated 401; an unrelated role 403", async () => {
    expect((await status(TENANT, "municipal-in-v1", ["install_user"])).code).toBe(200);
    expect((await app.inject({ method: "GET", url: STATUS_URL })).statusCode).toBe(401);
    expect((await status(TENANT, "municipal-in-v1", ["citizen"])).code).toBe(403);
  });
});
