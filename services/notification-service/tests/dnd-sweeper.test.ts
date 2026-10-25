/**
 * DND release sweeper ordering (CLOS3-S5-05): publish BEFORE releasing the held row, so a failed
 * publish leaves the row held for the next sweep instead of silently losing the notification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  findHeldNotifications: vi.fn(),
  releaseHeld: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/dnd/repo.js", () => ({
  findHeldNotifications: (...a: unknown[]) => H.findHeldNotifications(...a),
  releaseHeld: (...a: unknown[]) => H.releaseHeld(...a),
}));
vi.mock("@civitasone/db", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  runWithTenant: async (_t: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));

import { sweepHeldNotifications } from "../src/modules/dnd/sweeper.js";

const held = (id: string) => ({
  id, tenantId: "t1", userId: "u1", status: "held", deliveryPayload: { templateId: "tpl", recipient: "a@example.com" },
});

describe("DND release sweeper ordering", () => {
  const publish = vi.fn(async (..._a: unknown[]) => undefined);
  const queue = { publish } as never;
  beforeEach(() => {
    vi.clearAllMocks();
    H.releaseHeld.mockResolvedValue(undefined);
    publish.mockResolvedValue(undefined);
  });

  it("(a) a failed publish never releases the row, so it stays held for the next sweep", async () => {
    H.findHeldNotifications.mockResolvedValue([held("h1")]);
    publish.mockRejectedValueOnce(new Error("broker down"));
    expect(await sweepHeldNotifications(queue)).toBe(0);
    expect(H.releaseHeld).not.toHaveBeenCalled();
  });

  it("(b) a successful publish releases once, using the held id as messageId", async () => {
    H.findHeldNotifications.mockResolvedValue([held("h2")]);
    expect(await sweepHeldNotifications(queue)).toBe(1);
    expect(H.releaseHeld).toHaveBeenCalledTimes(1);
    expect(H.releaseHeld).toHaveBeenCalledWith(expect.anything(), "h2");
    expect(publish.mock.calls[0]![1]).toMatchObject({ messageId: "h2", correlationId: "h2", tenantId: "t1" });
  });

  it("(c) a release failure after publish republishes with the SAME messageId next sweep (consumer dedups)", async () => {
    H.findHeldNotifications.mockResolvedValue([held("h3")]);
    H.releaseHeld.mockRejectedValueOnce(new Error("db blip"));
    expect(await sweepHeldNotifications(queue)).toBe(0);
    expect(await sweepHeldNotifications(queue)).toBe(1);
    expect(publish).toHaveBeenCalledTimes(2);
    const ids = publish.mock.calls.map((c) => (c[1] as { messageId: string }).messageId);
    expect(ids).toEqual(["h3", "h3"]);
  });
});
