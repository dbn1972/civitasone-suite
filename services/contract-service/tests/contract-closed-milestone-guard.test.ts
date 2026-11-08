/**
 * UX-R5 / DS-3: a closed or terminated contract takes no milestone changes. completeMilestone and
 * markMilestoneLate refuse with 409 CONTRACT_CLOSED before anything is queued; an active contract still queues.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => ({
  publish: vi.fn(),
  findContractById: vi.fn(),
  findMilestoneById: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => H.publish(...a) },
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":") },
}));
vi.mock("../src/shared/procurement-client.js", () => ({
  resolvePoRef: async () => null,
  ProcurementUnavailableError: class extends Error {},
}));
vi.mock("../src/modules/contracts/repo.js", () => ({
  findContractById: (...a: unknown[]) => H.findContractById(...a),
  findMilestoneById: (...a: unknown[]) => H.findMilestoneById(...a),
}));

import { completeMilestone, markMilestoneLate, assertContractOpen } from "../src/modules/contracts/commands.js";

const TENANT = "aaaaaaaa-0000-4000-8000-0000000000c5";
const CONTRACT = "cccccccc-0000-4000-8000-0000000000c5";
const MILESTONE = "dddddddd-0000-4000-8000-0000000000c5";
const ctx = { tenantId: TENANT, actorId: "eeeeeeee-0000-4000-8000-0000000000c5", correlationId: "corr-c5", roles: ["procurement_admin"] } as never;

beforeEach(() => {
  vi.clearAllMocks();
  H.findMilestoneById.mockResolvedValue({ id: MILESTONE, status: "pending" });
  H.publish.mockResolvedValue(undefined);
});

describe("milestone changes on a finished contract (CONTRACT_CLOSED)", () => {
  for (const status of ["terminated", "closed"]) {
    it(`completeMilestone refuses a ${status} contract and queues nothing`, async () => {
      H.findContractById.mockResolvedValue({ id: CONTRACT, tenantId: TENANT, status });
      await expect(completeMilestone(ctx, CONTRACT, MILESTONE, { achievedDate: "2026-11-04" } as never))
        .rejects.toMatchObject({ status: 409, code: "CONTRACT_CLOSED" });
      expect(H.publish).not.toHaveBeenCalled();
    });

    it(`markMilestoneLate refuses a ${status} contract and queues nothing`, async () => {
      H.findContractById.mockResolvedValue({ id: CONTRACT, tenantId: TENANT, status });
      await expect(markMilestoneLate(ctx, CONTRACT, MILESTONE, { achievedDate: "2026-11-04" } as never))
        .rejects.toMatchObject({ status: 409, code: "CONTRACT_CLOSED" });
      expect(H.publish).not.toHaveBeenCalled();
    });
  }

  it("an active contract still queues the milestone completion", async () => {
    H.findContractById.mockResolvedValue({ id: CONTRACT, tenantId: TENANT, status: "active" });
    const res = await completeMilestone(ctx, CONTRACT, MILESTONE, { achievedDate: "2026-11-04" } as never);
    expect(res.status).toBe("accepted");
    expect(H.publish).toHaveBeenCalledTimes(1);
  });

  it("assertContractOpen allows every non-finished status", () => {
    for (const status of ["draft", "pending_approval", "approved", "active"]) expect(() => assertContractOpen({ status })).not.toThrow();
  });
});
