/**
 * submitDisbursementForApproval publishes with a DETERMINISTIC messageId
 * (idempotentId scoped to tenant + disbursement) so a retry / double-submit is
 * deduped by the consumer, rather than minting a fresh id each call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const { publish, repoMock } = vi.hoisted(() => ({
  publish: vi.fn(async () => undefined),
  repoMock: { findDisbursementById: vi.fn() },
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => (publish as any)(...a) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("../src/modules/disbursement/repo.js", () => repoMock);
vi.mock("../src/modules/application/repo.js", () => ({}));

import { submitDisbursementForApproval } from "../src/modules/disbursement/commands.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const MAKER = "20000000-bbbb-4000-8000-00000000000a";
const CHECKER = "20000000-bbbb-4000-8000-00000000000b";

describe("submitDisbursementForApproval — idempotent messageId", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("publishing twice yields the same messageId (dedupe), distinct per disbursement", async () => {
    const id = randomUUID(); const other = randomUUID();
    repoMock.findDisbursementById.mockResolvedValue({ id, createdBy: MAKER });
    const ctx = { tenantId: TENANT, actorId: CHECKER, correlationId: "c", roles: [] };
    await submitDisbursementForApproval(ctx as never, id);
    await submitDisbursementForApproval(ctx as never, id);
    await submitDisbursementForApproval(ctx as never, other);
    const ids = publish.mock.calls.map((c) => (c[1] as { messageId: string }).messageId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });
});
