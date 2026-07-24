/**
 * Shared infrastructure tests — publish.ts
 *
 * Covers: publishCommand generates UUID messageId, calls queue.publish with correct envelope
 *
 * _Requirements: Req 20 (Shared Infrastructure Test Coverage)_
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn().mockResolvedValue(undefined) },
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn() },
}));

import { publishCommand } from "../src/shared/publish.js";
import { queue } from "../src/shared/infra.js";
import type { RequestContext } from "../src/shared/context.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeCtx(overrides?: Partial<RequestContext>): RequestContext {
  return {
    actorId: "actor-1",
    tenantId: "tenant-1",
    roles: ["revenue_admin"],
    sessionId: "sess-1",
    correlationId: "corr-xyz",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("publish.ts — Shared Infrastructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("publishCommand", () => {
    it("generates a UUID messageId", async () => {
      const ctx = makeCtx();
      const result = await publishCommand("revenue.rate_head.create", ctx, { code: "PT" });

      expect(result.messageId).toMatch(UUID_PATTERN);
    });

    it("returns { messageId } matching the generated UUID", async () => {
      const ctx = makeCtx();
      const result = await publishCommand("revenue.assessee.create", ctx, { name: "test" });

      expect(result).toHaveProperty("messageId");
      expect(typeof result.messageId).toBe("string");
      expect(result.messageId).toMatch(UUID_PATTERN);
    });

    it("calls queue.publish with correct topic and envelope structure", async () => {
      const ctx = makeCtx({ tenantId: "t-99", actorId: "a-77", correlationId: "c-55" });
      const payload = { code: "WT", name: "Water Tax", category: "water" };

      const result = await publishCommand("revenue.rate_head.create", ctx, payload);

      expect(queue.publish).toHaveBeenCalledTimes(1);
      expect(queue.publish).toHaveBeenCalledWith("revenue.rate_head.create", expect.objectContaining({
        messageId: result.messageId,
        type: "revenue.rate_head.create",
        tenantId: "t-99",
        actorId: "a-77",
        correlationId: "c-55",
        schemaVersion: "1.0",
        payload,
      }));
    });

    it("envelope contains all required fields", async () => {
      const ctx = makeCtx();
      const payload = { assesseeId: "ass-1", amount: "5000" };

      await publishCommand("revenue.receipt.create", ctx, payload);

      const publishCall = vi.mocked(queue.publish).mock.calls[0];
      const [topic, envelope] = publishCall as [string, Record<string, unknown>];

      expect(topic).toBe("revenue.receipt.create");
      expect(envelope).toHaveProperty("messageId");
      expect(envelope).toHaveProperty("type", "revenue.receipt.create");
      expect(envelope).toHaveProperty("tenantId", ctx.tenantId);
      expect(envelope).toHaveProperty("actorId", ctx.actorId);
      expect(envelope).toHaveProperty("correlationId", ctx.correlationId);
      expect(envelope).toHaveProperty("schemaVersion", "1.0");
      expect(envelope).toHaveProperty("payload", payload);
    });

    it("generates unique messageIds across calls", async () => {
      const ctx = makeCtx();
      const result1 = await publishCommand("revenue.bill.generate", ctx, { id: "1" });
      const result2 = await publishCommand("revenue.bill.generate", ctx, { id: "2" });

      expect(result1.messageId).not.toBe(result2.messageId);
    });
  });
});
