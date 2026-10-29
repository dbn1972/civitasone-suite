/**
 * UAT FQ9 #36: POST /v1/inspection/sync/responses/partial answered 202 but the instance's responses
 * never changed — the route republished the save as an `inspection.sync.upload` (instance id as the
 * inspection id, sequenceNumber = Date.now()), which the sync consumer dead-letters as a sequence gap.
 * Given a checklist instance with one answer, When a partial save adds another, Then the route
 * publishes the checklist submit_response command and, once handled, both answers are on the instance.
 * A partial save for an unknown instance is a synchronous 404.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { checklistInstances } from "../src/modules/checklist/schema.js";
import { registerChecklistConsumers } from "../src/modules/checklist/consumer.js";
import { COMMANDS } from "../src/topics.js";

// JWT_SECRET is set for the suite by vitest.config.ts.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "f9b00000-0000-4000-8000-000000000036";
const ACTOR = randomUUID();
const INSTANCE = randomUUID();
const SECTIONS = [{
  id: "sec-1", title: "General", sortOrder: 1, weight: 1,
  questions: [
    { id: "q-1-1", text: "Fire exit clear?", fieldType: "boolean", sortOrder: 1, weight: 1, required: true },
    { id: "q-1-2", text: "Extinguisher present?", fieldType: "boolean", sortOrder: 2, weight: 1, required: true },
  ],
}];

let app: FastifyInstance;
const handlers = new Map<string, (msg: unknown) => Promise<void>>();
const headers = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["inspector"], sid: "sess-fq9-36" }, SECRET, 3600)}`,
});

beforeAll(async () => {
  registerChecklistConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => handlers.set(t, h) } as unknown as Queue);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(checklistInstances).values({
      id: INSTANCE, tenantId: TENANT, templateId: randomUUID(), templateVersion: 1,
      inspectionId: randomUUID(), sections: SECTIONS,
      responses: { "q-1-1": { value: true, answeredAt: "2026-10-29T08:00:00.000Z" } },
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const body = (instanceId: string) => ({
  instanceId, inspectorId: ACTOR, deviceId: "fq9-device",
  responses: { "q-1-2": { value: false, answeredAt: "2026-10-29T08:05:00.000Z", deviceTimestamp: 1793260000000 } },
  savedAt: "2026-10-29T08:05:01.000Z", completionPercent: 100,
});

describe("POST /v1/inspection/sync/responses/partial (UAT FQ9 #36)", () => {
  it("publishes a checklist submit_response (not a sync upload) and the answers are merged", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    let published: Array<[string, unknown]>;
    try {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/sync/responses/partial", headers: headers(), payload: body(INSTANCE) });
      expect(res.statusCode).toBe(202);
      published = spy.mock.calls.map((c) => [c[0] as string, c[1]]);
    } finally {
      spy.mockRestore();
    }
    expect(published.map(([t]) => t)).toEqual([COMMANDS.instanceSubmitResponse]);
    expect(published.map(([t]) => t)).not.toContain(COMMANDS.syncUpload);

    await runWithTenant(TENANT, () => handlers.get(COMMANDS.instanceSubmitResponse)!(published[0]![1]));

    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(checklistInstances).where(eq(checklistInstances.id, INSTANCE))));
    expect(row?.responses).toMatchObject({
      "q-1-1": { value: true },
      "q-1-2": { value: false, answeredAt: "2026-10-29T08:05:00.000Z" },
    });
    expect(row?.version).toBe(2);
  });

  it("404s a partial save for an instance that does not exist", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/inspection/sync/responses/partial", headers: headers(), payload: body(randomUUID()) });
    expect(res.statusCode).toBe(404);
  });
});
