/**
 * GAP2-GRANTS-INSTALLMENTS-07: separation of duties on a direct (non-approval
 * -gated) installment disbursement. The actor who created the installment or
 * who approved the underlying application may not directly disburse it.
 *
 *  - direct disburse (requireApproval=false) by the application approver → 403 SOD_VIOLATION
 *  - direct disburse by the installment creator → 403 SOD_VIOLATION
 *  - direct disburse by a distinct finance actor → publishes the command
 *  - requireApproval=true bypasses the direct-path SoD (routed through approval)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { publish, repoMock, appRepoMock } = vi.hoisted(() => ({
  publish: vi.fn(async () => undefined),
  repoMock: { findInstallmentById: vi.fn() },
  appRepoMock: { findApplicationById: vi.fn() },
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => (publish as any)(...a) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("@civitasone/auth", () => ({ idempotentId: () => "idem-1" }));
vi.mock("../src/modules/disbursement/repo.js", () => repoMock);
vi.mock("../src/modules/application/repo.js", () => appRepoMock);

import { inititateDisbursement } from "../src/modules/disbursement/commands.js";
import { disburseBody } from "../src/modules/disbursement/validators.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const APPROVER = "20000000-bbbb-4000-8000-0000000000a0";
const INSTALLMENT_CREATOR = "20000000-bbbb-4000-8000-0000000000c0";
const FINANCE = "20000000-bbbb-4000-8000-0000000000f0";
const INSTALLMENT = "30000000-cccc-4000-8000-000000000001";
const APPLICATION = "40000000-dddd-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
});

function ctxFor(actorId: string) {
  return { tenantId: TENANT, actorId, correlationId: "c", roles: [] } as never;
}

describe("GAP2-GRANTS-INSTALLMENTS-07 — direct disburse SoD", () => {
  it("application approver directly disbursing (requireApproval=false) → 403 SOD_VIOLATION", async () => {
    repoMock.findInstallmentById.mockResolvedValue({ id: INSTALLMENT, applicationId: APPLICATION, createdBy: INSTALLMENT_CREATOR });
    appRepoMock.findApplicationById.mockResolvedValue({ id: APPLICATION, approvedBy: APPROVER });
    await expect(inititateDisbursement(ctxFor(APPROVER), INSTALLMENT, disburseBody.parse({})))
      .rejects.toMatchObject({ status: 403, code: "SOD_VIOLATION" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("installment creator directly disbursing → 403 SOD_VIOLATION", async () => {
    repoMock.findInstallmentById.mockResolvedValue({ id: INSTALLMENT, applicationId: APPLICATION, createdBy: INSTALLMENT_CREATOR });
    appRepoMock.findApplicationById.mockResolvedValue({ id: APPLICATION, approvedBy: APPROVER });
    await expect(inititateDisbursement(ctxFor(INSTALLMENT_CREATOR), INSTALLMENT, disburseBody.parse({})))
      .rejects.toMatchObject({ status: 403, code: "SOD_VIOLATION" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("a distinct finance actor directly disbursing → publishes the command", async () => {
    repoMock.findInstallmentById.mockResolvedValue({ id: INSTALLMENT, applicationId: APPLICATION, createdBy: INSTALLMENT_CREATOR });
    appRepoMock.findApplicationById.mockResolvedValue({ id: APPLICATION, approvedBy: APPROVER });
    const res = await inititateDisbursement(ctxFor(FINANCE), INSTALLMENT, disburseBody.parse({}));
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("requireApproval=true bypasses the direct-path SoD (routed through approval)", async () => {
    // Even the approver may initiate the APPROVAL-GATED path — the eOffice
    // decidedBy ≠ initiator check applies downstream. The installment read is
    // not even performed on this path.
    const res = await inititateDisbursement(ctxFor(APPROVER), INSTALLMENT, disburseBody.parse({ requireApproval: true }));
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(repoMock.findInstallmentById).not.toHaveBeenCalled();
  });

  it("direct disburse of an unknown installment → 404 NOT_FOUND", async () => {
    repoMock.findInstallmentById.mockResolvedValue(null);
    await expect(inititateDisbursement(ctxFor(FINANCE), INSTALLMENT, disburseBody.parse({})))
      .rejects.toMatchObject({ status: 404 });
    expect(publish).not.toHaveBeenCalled();
  });
});
