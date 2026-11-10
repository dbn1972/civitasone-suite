import { describe, it, expect, beforeEach, vi } from "vitest";
import { NonRetryableError, type Queue } from "@civitasone/queue";

const H = vi.hoisted(() => ({
  weedout: null as null | { status: string; proposedBy: string; fileId: string },
  record: null as null | { recordCategory: string; reviewDueDate: string | null },
  infraError: null as Error | null,
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => { if (H.infraError) throw H.infraError; return fn({}); } },
}));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidate: vi.fn(async () => undefined), makeKey: () => "k" } }));
vi.mock("../src/shared/outbox.js", () => ({ markProcessed: vi.fn(async () => true), enqueue: vi.fn(async () => undefined) }));
vi.mock("../src/modules/records/repo.js", () => ({
  findWeedoutByIdTx: vi.fn(async () => H.weedout),
  findRecordTx: vi.fn(async () => H.record),
  updateWeedout: vi.fn(async () => undefined),
}));

import { registerRecordsConsumers } from "../src/modules/records/consumer.js";
import { COMMANDS } from "../src/modules/records/commands.js";

const handlers = new Map<string, (m: unknown) => Promise<void>>();
registerRecordsConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); }, publish: async () => {} } as unknown as Queue);

const TENANT = "8dcb509d-1a2e-41dc-8dbd-61a3a11b9d93";
const WO = "1c2d3e4f-0000-4000-8000-0000000000a1";
const MAKER = "aaaaaaaa-0000-4000-8000-000000000001";
const CHECKER = "bbbbbbbb-0000-4000-8000-000000000002";
const approve = (actorId: string) =>
  handlers.get(COMMANDS.weedoutApprove)!({ messageId: "m-1", tenantId: TENANT, actorId, correlationId: "c", payload: { id: WO, tenantId: TENANT } });

/**
 * REGRESSION (UAT 9 Nov): weed-out approve threw DomainError for deterministic business refusals
 * (wrong state, maker=checker, retention not elapsed, permanent record). A plain Error is retried 5x
 * then dead-lettered; a NonRetryableError goes straight to the DLQ.
 */
describe("estab weed-out approve: business refusals are non-retryable, infrastructure errors still retry", () => {
  beforeEach(() => { H.weedout = null; H.record = null; H.infraError = null; });

  it("not in proposed state", async () => {
    H.weedout = { status: "approved", proposedBy: MAKER, fileId: "f1" };
    await expect(approve(CHECKER)).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("maker = checker", async () => {
    H.weedout = { status: "proposed", proposedBy: MAKER, fileId: "f1" };
    await expect(approve(MAKER)).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("retention not elapsed / permanent record", async () => {
    H.weedout = { status: "proposed", proposedBy: MAKER, fileId: "f1" };
    H.record = { recordCategory: "B", reviewDueDate: "2099-01-01" };
    await expect(approve(CHECKER)).rejects.toBeInstanceOf(NonRetryableError);
    H.record = { recordCategory: "A", reviewDueDate: null };
    await expect(approve(CHECKER)).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("an infrastructure error (DB down) is NOT wrapped and stays retryable", async () => {
    H.infraError = new Error("connection terminated unexpectedly");
    const err = await approve(CHECKER).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
  });
});
