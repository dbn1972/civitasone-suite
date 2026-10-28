import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
}));

import { createReport, submitReport, approveReport } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan): submit and approve used messageId = reportId, the same id the
 * create command had put in _inbox.processed. (Note: no consumer for inspection.report.* exists yet;
 * this only guarantees the commands are not dropped once one does.)
 */
describe("inspection report commands: per-command messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("create, submit, approve, then a resubmit after rejection all carry distinct messageIds", async () => {
    const created = await createReport(ctx, { inspectionId: randomUUID(), entityId: randomUUID() });
    await submitReport(ctx, created.id);
    await approveReport(ctx, created.id);
    await submitReport(ctx, created.id);
    const ids = published.map((p) => p.messageId);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(1).every((m) => m !== created.id)).toBe(true);
  });
});
