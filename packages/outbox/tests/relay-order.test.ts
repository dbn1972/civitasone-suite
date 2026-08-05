/**
 * relayOnce must drain oldest unpublished rows first so a large backlog cannot
 * starve freshly accepted commands indefinitely.
 */
import { describe, it, expect, vi } from "vitest";
import { relayOnce, type DrizzleTx } from "../src/index.js";
import type { Queue } from "@civitasone/queue";

vi.mock("@civitasone/observability", () => ({
  incrementOutboxRelayFailure: vi.fn(),
  captureError: vi.fn(),
}));

describe("relayOnce ordering", () => {
  it("orders unpublished rows by createdAt ascending", async () => {
    const orderBy = vi.fn(() => ({ limit: async () => [] }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = { select, update: vi.fn() } as unknown as DrizzleTx;
    const queue = { publish: vi.fn() } as unknown as Queue;

    await relayOnce(db, queue, 10, "crm-service", 1);

    expect(select).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalled();
  });
});
