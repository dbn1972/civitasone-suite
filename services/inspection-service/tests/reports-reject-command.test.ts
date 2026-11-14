/**
 * Gap-fix wave (HANDOFF 5 item 7): the reject command publishes the topic the reject consumer subscribes to,
 * carrying the rejecting officer (from the verified request context) and the reason.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { rejectReport } from "../src/modules/reports/commands.js";
import { queue } from "../src/shared/infra.js";

describe("rejectReport command", () => {
  it("publishes inspection.report.reject with id, tenant, rejecter and reason, and answers accepted", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const tenantId = randomUUID();
      const actorId = randomUUID();
      const reportId = randomUUID();
      const correlationId = randomUUID();
      const out = await rejectReport({ tenantId, actorId, correlationId } as never, reportId, "Summary does not match the observations");
      expect(out).toEqual({ id: reportId, status: "accepted", correlationId });
      expect(spy).toHaveBeenCalledTimes(1);
      const [topic, message] = spy.mock.calls[0] as [string, { payload: Record<string, unknown> }];
      expect(topic).toBe("inspection.report.reject");
      expect(message.payload).toMatchObject({
        id: reportId, tenantId, rejecterId: actorId, reason: "Summary does not match the observations",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
