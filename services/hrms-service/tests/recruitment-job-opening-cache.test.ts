/**
 * Corrigendum / extension / cancellation change a vacancy's status, deadline and corrigendum count, all of
 * which the cached job-openings list (resource "job_opening") shows. Each must invalidate it like publish does
 * (CLOS3-S5-17).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  handler: undefined as undefined | ((msg: unknown) => Promise<void>),
  invalidateResourceAfterCommit: vi.fn(async () => undefined),
  updateVacancy: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ __tx: true }) },
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidateResourceAfterCommit: (...a: unknown[]) => H.invalidateResourceAfterCommit(...(a as [])) },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: vi.fn(async () => undefined) }));
vi.mock("../src/modules/recruitment/publication-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findVacancyTx: async () => ({ id: "j1", version: 3, applicationDeadline: null, isPublished: true, status: "open" }),
  nextCorrigendumSeqTx: async () => 2,
  insertCorrigendum: async () => undefined,
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

describe("job-opening cache invalidation on vacancy mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerF3_recruitment_Consumers({
      subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { H.handler = h; },
    } as never);
  });

  it.each([
    ["recruitment_publication_routes__1 (corrigendum)", "recruitment_publication_routes__1", { changes: "x" }],
    ["recruitment_publication_routes__2 (extension)", "recruitment_publication_routes__2", { newDeadline: "2027-01-01" }],
    ["recruitment_publication_routes__3 (cancellation)", "recruitment_publication_routes__3", { reason: "withdrawn" }],
  ])("%s invalidates job_opening exactly once", async (_label, op, body) => {
    await run(op, body);
    expect(H.updateVacancy).toHaveBeenCalledTimes(1);
    expect(H.invalidateResourceAfterCommit).toHaveBeenCalledTimes(1);
    expect(H.invalidateResourceAfterCommit).toHaveBeenCalledWith(expect.anything(), TENANT, "job_opening");
  });

  it("publish/unpublish (__4) still invalidates once", async () => {
    await run("recruitment_publication_routes__4", { isPublished: false });
    expect(H.invalidateResourceAfterCommit).toHaveBeenCalledTimes(1);
    expect(H.invalidateResourceAfterCommit).toHaveBeenCalledWith(expect.anything(), TENANT, "job_opening");
  });
});
