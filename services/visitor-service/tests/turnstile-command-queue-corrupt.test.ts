/**
 * CLOS2-S6-09 — a corrupt entry in a device command queue must be discarded and skipped,
 * not thrown out of dequeueCommand (which 500s the device poll and delays the next valid command).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("pino", () => {
  const pino = () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() });
  return { default: pino, pino };
});
import {
  dequeueCommand,
  enqueueCommand,
  getQueueLength,
  resetCommandQueuesForTests,
  type CommandEntry,
} from "../src/modules/turnstile-control/command-queue.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const DEVICE = "device-1";

const valid: CommandEntry = {
  id: "cmd-1",
  commandType: "open",
  payload: {},
  correlationId: null,
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/**
 * Seed a raw (corrupt) string at the oldest position of the in-memory FIFO. enqueueCommand serializes with
 * JSON.stringify, so intercept exactly that one call to inject a non-JSON payload.
 */
async function pushRawOldest(raw: string): Promise<void> {
  const spy = vi.spyOn(JSON, "stringify").mockReturnValueOnce(raw);
  try {
    await enqueueCommand(TENANT, DEVICE, valid);
  } finally {
    spy.mockRestore();
  }
}

describe("dequeueCommand — corrupt entries", () => {
  beforeEach(() => {
    resetCommandQueuesForTests();
    warn.mockClear();
  });

  it("skips a corrupt entry and returns the next valid command", async () => {
    await pushRawOldest("garbage");
    await enqueueCommand(TENANT, DEVICE, valid);
    await expect(dequeueCommand(TENANT, DEVICE)).resolves.toEqual(valid);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("garbage");
  });

  it("returns null when the queue only holds a corrupt entry", async () => {
    await pushRawOldest("garbage");
    await expect(dequeueCommand(TENANT, DEVICE)).resolves.toBeNull();
    await expect(getQueueLength(TENANT, DEVICE)).resolves.toBe(0);
  });
});
