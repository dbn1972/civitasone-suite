/**
 * UAT bundle 9 (B9-insp): reports.inspection_reports recorded no submitter. The F63 approve consumer
 * used updated_by as a proxy, so a later write to the row (updated_by = someone else) let the real
 * submitter approve their own report, and the audit trail could not name the submitter.
 * Real-DB: drives the registered consumers against migration 0034 (submitted_by).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { isNonRetryable, type Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { registerReportsConsumers } from "../src/modules/reports/consumer.js";
import { findReportById } from "../src/modules/reports/repo.js";
import { inspectionReports } from "../src/modules/reports/schema.js";

const TENANT = "b9a00000-0000-4000-8000-0000000000b9";
const INSPECTOR = randomUUID();
const SUBMITTER = randomUUID();
const OTHER = randomUUID();
const CHECKER = randomUUID();

const handlers = new Map<string, (msg: unknown) => Promise<void>>();
registerReportsConsumers({
  subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); },
} as unknown as Queue);

afterAll(async () => { await sqlClient.end(); });

function send(topic: string, actorId: string, payload: Record<string, unknown>, messageId: string = randomUUID()) {
  const h = handlers.get(topic);
  if (!h) throw new Error(`no consumer subscribed to ${topic}`);
  return runWithTenant(TENANT, () => h({
    messageId, type: topic, tenantId: TENANT, actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload,
  }));
}
async function rejection(p: Promise<void>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  return undefined;
}
const row = (id: string) => runWithTenant(TENANT, () => findReportById(TENANT, id));

async function submittedReport(): Promise<string> {
  const id = randomUUID();
  await send("inspection.report.create", INSPECTOR, {
    id, tenantId: TENANT, inspectorId: INSPECTOR, inspectionId: randomUUID(), entityId: randomUUID(),
  }, id);
  await send("inspection.report.submit", SUBMITTER, { id, tenantId: TENANT });
  return id;
}

describe("inspection report submitted_by (UAT b9 B9-insp)", () => {
  it("submit records the JWT actor as submitted_by", async () => {
    const id = await submittedReport();
    expect(await row(id)).toMatchObject({ status: "submitted", submittedBy: SUBMITTER });
  });

  it("refuses approval by the submitter even after another actor wrote the row", async () => {
    const id = await submittedReport();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(inspectionReports)
      .set({ updatedBy: OTHER })
      .where(and(eq(inspectionReports.tenantId, TENANT), eq(inspectionReports.id, id)))));

    const err = await rejection(send("inspection.report.approve", SUBMITTER, { id, tenantId: TENANT, approverId: SUBMITTER }));
    expect(isNonRetryable(err)).toBe(true);
    expect(String((err as Error).message)).toMatch(/maker-checker/i);
    expect((await row(id))?.status).toBe("submitted");

    await send("inspection.report.approve", CHECKER, { id, tenantId: TENANT, approverId: CHECKER });
    expect(await row(id)).toMatchObject({ status: "approved", approvedBy: CHECKER, submittedBy: SUBMITTER });
  });

  it("a legacy submitted row (submitted_by NULL) still refuses its submitter via updated_by", async () => {
    const id = await submittedReport();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(inspectionReports)
      .set({ submittedBy: null })
      .where(and(eq(inspectionReports.tenantId, TENANT), eq(inspectionReports.id, id)))));
    const err = await rejection(send("inspection.report.approve", SUBMITTER, { id, tenantId: TENANT, approverId: SUBMITTER }));
    expect(isNonRetryable(err)).toBe(true);
    expect((await row(id))?.status).toBe("submitted");
  });
});
