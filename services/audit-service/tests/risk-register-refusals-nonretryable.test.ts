import { describe, it, expect, beforeEach, vi } from "vitest";
import { NonRetryableError, type Queue } from "@civitasone/queue";

const H = vi.hoisted(() => ({ row: null as unknown, infraError: null as Error | null }));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => { if (H.infraError) throw H.infraError; return fn({}); } },
}));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidate: vi.fn(async () => undefined), invalidateResource: vi.fn(async () => undefined), makeKey: () => "k" } }));
vi.mock("../src/shared/outbox.js", () => ({ markProcessed: vi.fn(async () => true), enqueue: vi.fn(async () => undefined) }));
vi.mock("../src/modules/risk-register/repo.js", async (orig) => ({ ...(await orig<object>()), findAcceptanceByIdTx: vi.fn(async () => H.row) }));

import { registerRiskRegisterConsumers } from "../src/modules/risk-register/consumer.js";
import { COMMANDS } from "../src/topics.js";

const handlers = new Map<string, (m: unknown) => Promise<void>>();
registerRiskRegisterConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); }, publish: async () => {} } as unknown as Queue);

const TENANT = "8dcb509d-1a2e-41dc-8dbd-61a3a11b9d93";
const decide = () => handlers.get(COMMANDS.riskAcceptanceDecide)!({
  messageId: "m-1", tenantId: TENANT, actorId: "bbbbbbbb-0000-4000-8000-000000000002", correlationId: "c",
  payload: { acceptanceId: "1c2d3e4f-0000-4000-8000-0000000000a1", tenantId: TENANT, decision: "approved" },
});

/** REGRESSION (UAT 9 Nov): deterministic refusals were plain Errors, retried 5x then dead-lettered. */
describe("risk-register riskAcceptanceDecide: business refusals are non-retryable, infrastructure errors still retry", () => {
  beforeEach(() => { H.row = null; H.infraError = null; });

  it("target not found stays retryable (a follow-on command can race ahead of its create)", async () => {
    const err = await decide().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
  });

  it("target already decided is permanent", async () => {
    H.row = { status: "approved", requestedBy: "aaaaaaaa-0000-4000-8000-000000000001", version: 1 };
    await expect(decide()).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("an infrastructure error (DB down) is NOT wrapped and stays retryable", async () => {
    H.infraError = new Error("connection terminated unexpectedly");
    const err = await decide().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
  });
});
