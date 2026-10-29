/**
 * UAT FQ9 #24: POST /v1/inspection/findings with questionId "q-1-1" (a real checklist question id —
 * the checklist consumer generates them as "q-{section}-{question}") or with no questionId was
 * accepted, then dead-lettered: `invalid input syntax for type uuid` (0009 made question_id UUID and
 * the consumer wrote "" when it was absent).
 * Given a provision, When a finding is created with a checklist question id, Then it is stored with
 * that id; When created without one, Then question_id is NULL. The route rejects an empty questionId
 * synchronously (400) instead of accepting a command that cannot be stored.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { provisions } from "../src/modules/universe/schema.js";
import { registerFindingsConsumers } from "../src/modules/findings/consumer.js";
import { findings } from "../src/modules/findings/schema.js";
import { COMMANDS } from "../src/topics.js";

// JWT_SECRET is set for the suite by vitest.config.ts.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "f9b00000-0000-4000-8000-000000000024";
const ACTOR = randomUUID();
const PROVISION = randomUUID();

let app: FastifyInstance;
const handlers = new Map<string, (msg: unknown) => Promise<void>>();

beforeAll(async () => {
  registerFindingsConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => handlers.set(t, h) } as unknown as Queue);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(provisions).values({
      id: PROVISION, tenantId: TENANT, actReference: "FQ9 Act", sectionNumber: "9",
      description: "FQ9 provision", severityClass: "minor", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createFinding(questionId?: string): Promise<{ questionId: string | null } | undefined> {
  const messageId = randomUUID();
  const description = `FQ9 finding ${messageId}`;
  const payload: Record<string, unknown> = {
    inspectionId: randomUUID(), provisionId: PROVISION, description, tenantId: TENANT,
  };
  if (questionId !== undefined) payload.questionId = questionId;
  await runWithTenant(TENANT, () => handlers.get(COMMANDS.findingCreate)!({
    messageId, type: COMMANDS.findingCreate, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  }));
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select({ questionId: findings.questionId }).from(findings)
      .where(and(eq(findings.tenantId, TENANT), eq(findings.description, description))),
  ));
  return rows[0];
}

describe("finding questionId (UAT FQ9 #24)", () => {
  it("stores a checklist question id such as q-1-1", async () => {
    const f = await createFinding("q-1-1");
    expect(f?.questionId).toBe("q-1-1");
  });

  it("stores NULL when no questionId is given", async () => {
    const f = await createFinding();
    expect(f).toBeDefined();
    expect(f?.questionId).toBeNull();
  });

  it("route: rejects an empty questionId with 400, accepts q-1-1 and an absent one with 202", async () => {
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["inspector"], sid: "sess-fq9-24" }, SECRET, 3600);
    const post = (body: Record<string, unknown>) => app.inject({
      method: "POST", url: "/v1/inspection/findings",
      headers: { authorization: `Bearer ${token}` },
      payload: { inspectionId: randomUUID(), provisionId: PROVISION, description: "d", ...body },
    });
    expect((await post({ questionId: "" })).statusCode).toBe(400);
    expect((await post({ questionId: "x".repeat(65) })).statusCode).toBe(400);
    expect((await post({ questionId: "q-1-1" })).statusCode).toBe(202);
    expect((await post({})).statusCode).toBe(202);
  });
});
