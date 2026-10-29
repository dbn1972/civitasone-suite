/**
 * UAT FQ9 #23: POST /v1/inspection/reports answered 202 but no report row was ever written —
 * `inspection.report.create` had no subscriber (queue_publish_no_subscribers).
 * Given the worker, Then it registers the reports consumer; and given a report.create command,
 * When the consumer handles it (twice: redelivery), Then exactly one draft report exists.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithTenant } from "@civitasone/db";
import type { Queue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { registerReportsConsumers, REPORT_CREATE_TOPIC } from "../src/modules/reports/consumer.js";
import { createReport } from "../src/modules/reports/commands.js";
import { queue } from "../src/shared/infra.js";
import { findReportById } from "../src/modules/reports/repo.js";

const TENANT = "f9b00000-0000-4000-8000-000000000023";
const ACTOR = randomUUID();

afterAll(async () => { await sqlClient.end(); });

function capture(): Map<string, (msg: unknown) => Promise<void>> {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  registerReportsConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => handlers.set(t, h) } as unknown as Queue);
  return handlers;
}

describe("inspection reports consumer (UAT FQ9 #23)", () => {
  it("the worker registers the reports consumers", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "src", "worker.ts"), "utf8");
    expect(src).toMatch(/import \{ registerReportsConsumers \} from "\.\/modules\/reports\/consumer\.js"/);
    expect(src).toMatch(/^registerReportsConsumers\(scopedQueue\);$/m);
  });

  it("subscribes the exact topic the create command publishes", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      await createReport(
        { tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID() } as never,
        { inspectionId: randomUUID(), entityId: randomUUID() },
      );
      expect(spy.mock.calls.map((c) => c[0])).toEqual([REPORT_CREATE_TOPIC]);
    } finally {
      spy.mockRestore();
    }
    expect(capture().has(REPORT_CREATE_TOPIC)).toBe(true);
  });

  it("writes one draft report per command, idempotently on redelivery", async () => {
    const handler = capture().get(REPORT_CREATE_TOPIC)!;
    const id = randomUUID();
    const inspectionId = randomUUID();
    const msg = {
      messageId: id, type: REPORT_CREATE_TOPIC, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id, tenantId: TENANT, inspectorId: ACTOR, inspectionId, entityId: randomUUID(),
        reportType: "surprise", summary: "FQ9 summary", overallGrade: "B",
      },
    };
    await runWithTenant(TENANT, () => handler(msg));
    // Redelivery must be a no-op (inbox dedup), not a duplicate-key failure.
    await expect(runWithTenant(TENANT, () => handler(msg))).resolves.toBeUndefined();

    const row = await runWithTenant(TENANT, () => findReportById(TENANT, id));
    expect(row).toMatchObject({
      id, tenantId: TENANT, inspectionId, inspectorId: ACTOR, status: "draft",
      reportType: "surprise", summary: "FQ9 summary", overallGrade: "B", createdBy: ACTOR,
    });
  });
});
