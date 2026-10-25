/**
 * CLOS3-S5-06 -- the publication consumer cases for corrigendum (__1),
 * extension (__2) and cancellation (__3) did not re-validate the vacancy state
 * at write time. The routes reject a cancelled vacancy BEFORE enqueueing, but
 * two commands queued back to back both pass: cancel then extend re-opened a
 * cancelled vacancy (status "open"), and a duplicate cancel wrote a second
 * cancellation corrigendum.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  handler: undefined as undefined | ((msg: unknown) => Promise<void>),
  status: "open" as string,
  insertCorrigendum: vi.fn(async () => undefined),
  nextSeq: vi.fn(async () => 2),
  updateVacancy: vi.fn(async () => undefined),
  invalidate: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ __tx: true }) },
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidateResourceAfterCommit: (...a: unknown[]) => H.invalidate(...(a as [])) },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: vi.fn(async () => undefined) }));
vi.mock("../src/modules/recruitment/publication-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findVacancyTx: async () => ({
    id: "j1", version: 3, applicationDeadline: new Date("2026-12-01"), isPublished: true, status: H.status,
  }),
  nextCorrigendumSeqTx: (...a: unknown[]) => H.nextSeq(...(a as [])),
  insertCorrigendum: (...a: unknown[]) => H.insertCorrigendum(...(a as [])),
  updateVacancy: (...a: unknown[]) => H.updateVacancy(...(a as [])),
}));

import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";

const TENANT = "00000000-0000-0000-0000-000000000001";

async function run(op: string, body: Record<string, unknown>): Promise<void> {
  await H.handler!({
    messageId: `m-${op}`, actorId: "a1", correlationId: "c1",
    payload: { op, id: "j1", tenantId: TENANT, body, params: { id: "j1" }, query: {} },
  });
}

describe("CLOS3-S5-06 publication consumer re-checks vacancy state at write time", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.status = "open";
    registerF3_recruitment_Consumers({
      subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { H.handler = h; },
    } as never);
  });

  it.each([
    ["corrigendum (__1)", "recruitment_publication_routes__1", { changes: "x" }, "CANCELLED"],
    ["extension (__2)", "recruitment_publication_routes__2", { newDeadline: "2027-01-01" }, "CANCELLED"],
    ["duplicate cancel (__3)", "recruitment_publication_routes__3", { reason: "withdrawn" }, "ALREADY_CANCELLED"],
  ])("%s on a cancelled vacancy is rejected 409 and writes nothing", async (_l, op, body, code) => {
    H.status = "cancelled";
    await expect(run(op, body)).rejects.toMatchObject({ status: 409, code });
    expect(H.insertCorrigendum).not.toHaveBeenCalled();
    expect(H.updateVacancy, "a cancelled vacancy must not be reopened").not.toHaveBeenCalled();
    expect(H.nextSeq).not.toHaveBeenCalled();
  });

  it.each([
    ["recruitment_publication_routes__1", { changes: "x" }],
    ["recruitment_publication_routes__2", { newDeadline: "2027-01-01" }],
    ["recruitment_publication_routes__3", { reason: "withdrawn" }],
  ])("%s on an open vacancy still applies", async (op, body) => {
    await run(op, body);
    expect(H.insertCorrigendum).toHaveBeenCalledTimes(1);
    expect(H.updateVacancy).toHaveBeenCalledTimes(1);
  });
});
