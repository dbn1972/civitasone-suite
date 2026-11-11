import { describe, it, expect, beforeEach, vi } from "vitest";
import { NonRetryableError, type Queue } from "@civitasone/queue";

const H = vi.hoisted(() => ({ insertError: null as unknown }));

vi.mock("../src/shared/db.js", () => ({ db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) } }));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidateResource: vi.fn(async () => undefined), invalidate: vi.fn(async () => undefined), makeKey: () => "k" } }));
vi.mock("../src/shared/outbox.js", () => ({ markProcessed: vi.fn(async () => true), enqueue: vi.fn(async () => undefined) }));
vi.mock("../src/shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));
vi.mock("../src/modules/contracts/repo.js", () => ({
  insertContract: vi.fn(async () => { if (H.insertError) throw H.insertError; }),
}));

import { registerContractConsumers } from "../src/modules/contracts/consumer.js";
import { COMMANDS } from "../src/topics.js";

const handlers = new Map<string, (m: unknown) => Promise<void>>();
registerContractConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); }, publish: async () => {} } as unknown as Queue);

const TENANT = "8dcb509d-1a2e-41dc-8dbd-61a3a11b9d93";
const create = () => handlers.get(COMMANDS.contractCreate)!({
  messageId: "m-1", tenantId: TENANT, actorId: "aaaaaaaa-0000-4000-8000-000000000001", correlationId: "c",
  payload: {
    id: "1c2d3e4f-0000-4000-8000-0000000000b1", tenantId: TENANT, contractNo: "SMC/WORKS/2026-27/0142",
    vendorId: "2c2d3e4f-0000-4000-8000-0000000000b2", title: "Annual road maintenance, Zone 3", valueMinor: 125000000,
    startDate: "2026-11-01", expiry: "2027-10-31",
  },
});

/**
 * REGRESSION (UAT 9 Nov): contract.create with a contract_no that already exists for the tenant
 * hit UNIQUE (tenant_id, contract_no) -> postgres 23505 thrown as a plain error -> retried 5x, DLQ.
 */
describe("contract.create: duplicate contract_no is a permanent rejection", () => {
  beforeEach(() => { H.insertError = null; });

  it("unique_violation (23505) -> NonRetryableError", async () => {
    H.insertError = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    await expect(create()).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("unique_violation wrapped in cause -> NonRetryableError", async () => {
    H.insertError = Object.assign(new Error("query failed"), { cause: { code: "23505" } });
    await expect(create()).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("infrastructure errors stay retryable", async () => {
    H.insertError = Object.assign(new Error("connection terminated unexpectedly"), { code: "08006" });
    const err = await create().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
  });
});
