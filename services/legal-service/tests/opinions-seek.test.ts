/**
 * opinions-seek.test.ts — GAP-LEGAL-OPINIONS-NEW-01 / NEW-02 / OPINIONS-04.
 *
 * Verifies the real opinions CREATE path that the web "Seek Opinion" form now
 * posts to (POST /v1/legal/opinions), the server-side OPN/<year>/NNNN number
 * allocation when the client omits a reference, role enforcement, and that the
 * list/detail queries return the created row under the documented field names.
 *
 * Pattern: wireTenantAwareQueue + runWithTenant (RLS-safe), mirroring
 * consumers-coverage.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { legalOpinions } from "../src/modules/opinions/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerOpinionConsumers } from "../src/modules/opinions/consumer.js";
import * as opinionQueries from "../src/modules/opinions/queries.js";
import { cache } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000d01";
const TENANT = "11111111-aaaa-4000-8000-000000000d01";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const MSG = (n: number): string => `77777777-dddd-4000-8000-000000000d${String(n).padStart(2, "0")}`;

function token(roles: string[] = ["legal_officer"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}
function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function drain(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 300));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalOpinions).where(eq(legalOpinions.tenantId, TENANT));
    for (let i = 1; i <= 20; i++) {
      await tx.delete(processed).where(eq(processed.messageId, MSG(i)));
    }
  }));
  await cache.invalidateResource(TENANT, "opinion");
  await cache.invalidateResource(TENANT, "opinions");
}

let app: FastifyInstance;

beforeAll(async () => {
  await wipe();
  app = await buildApp();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/legal/opinions — route guard", () => {
  it("202 with a valid body (opinionNo omitted)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      headers: authHeader(),
      payload: { subject: "Tender dispute", question: "Can the tender be cancelled?" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(typeof res.json().id).toBe("string");
  });

  it("400 when subject/question missing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      headers: authHeader(),
      payload: { subject: "only subject" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 for a non-legal role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      headers: authHeader(["citizen"]),
      payload: { subject: "x", question: "y" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 with no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      payload: { subject: "x", question: "y" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("opinionSeek consumer — server-side OPN/<year>/NNNN allocation", () => {
  it("allocates sequential numbers when opinionNo is omitted and persists the row", async () => {
    await wipe();
    const queue = wireTenantAwareQueue(new MemoryQueue());
    registerOpinionConsumers(queue);
    const year = new Date().getFullYear();

    const idA = "aaaaaaaa-0000-4000-8000-000000000d01";
    const idB = "bbbbbbbb-0000-4000-8000-000000000d02";

    await runWithTenant(TENANT, async () => {
      await queue.publish(COMMANDS.opinionSeek, {
        messageId: MSG(1), type: COMMANDS.opinionSeek,
        tenantId: TENANT, actorId: ACTOR, correlationId: "c1", schemaVersion: "1.0",
        payload: { id: idA, tenantId: TENANT, subject: "First", question: "Q1" },
      });
    });
    await drain();
    await runWithTenant(TENANT, async () => {
      await queue.publish(COMMANDS.opinionSeek, {
        messageId: MSG(2), type: COMMANDS.opinionSeek,
        tenantId: TENANT, actorId: ACTOR, correlationId: "c2", schemaVersion: "1.0",
        payload: { id: idB, tenantId: TENANT, subject: "Second", question: "Q2" },
      });
    });
    await drain();

    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(legalOpinions).where(eq(legalOpinions.tenantId, TENANT))));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const a = byId.get(idA);
    const b = byId.get(idB);

    expect(a?.opinionNo).toBe(`OPN/${year}/0001`);
    expect(b?.opinionNo).toBe(`OPN/${year}/0002`);
    // distinct numbers, both in the OPN series — the Math.random() client
    // behaviour this replaces could collide and did not follow the series.
    expect(a?.opinionNo).not.toBe(b?.opinionNo);
    expect(a?.status).toBe("sought");
    expect(a?.soughtBy ?? null).toBeNull();
  });

  it("honours a client-supplied opinionNo when present", async () => {
    await wipe();
    const queue = wireTenantAwareQueue(new MemoryQueue());
    registerOpinionConsumers(queue);
    const id = "cccccccc-0000-4000-8000-000000000d03";
    await runWithTenant(TENANT, async () => {
      await queue.publish(COMMANDS.opinionSeek, {
        messageId: MSG(3), type: COMMANDS.opinionSeek,
        tenantId: TENANT, actorId: ACTOR, correlationId: "c3", schemaVersion: "1.0",
        payload: { id, tenantId: TENANT, opinionNo: "CUSTOM/1", subject: "S", question: "Q" },
      });
    });
    await drain();
    const opinion = await runWithTenant(TENANT, () => opinionQueries.getOpinion(id, TENANT));
    expect(opinion?.opinionNo).toBe("CUSTOM/1");
    // OPINIONS-04: list/detail expose the documented soughtBy/counselName names.
    expect(opinion).toHaveProperty("soughtBy");
    expect(opinion).toHaveProperty("counselName");
  });
});
