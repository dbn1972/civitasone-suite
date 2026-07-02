/**
 * Employee commands unit tests — mock-based.
 * Tests all command functions that publish to queue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const { publishMock, putMock, invalidateMock } = vi.hoisted(() => ({
  publishMock: vi.fn(async () => randomUUID()),
  putMock: vi.fn(async () => undefined),
  invalidateMock: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: any[]) => publishMock(...a) },
  cache: { put: (...a: any[]) => putMock(...a), invalidate: (...a: any[]) => invalidateMock(...a), makeKey: (...parts: string[]) => parts.join(":") },
}));

import {
  createEmployee, confirmEmployee, transferEmployee,
  separateEmployee, updateEmployee,
  submitTransferForApproval, submitPromotionForApproval,
} from "../src/modules/employee/commands.js";
import type { RequestContext } from "@civitasone/types";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function ctx(): RequestContext {
  return { tenantId: TENANT, actorId: ACTOR, roles: ["hr_admin"], correlationId: randomUUID(), sessionId: "s1" } as RequestContext;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("createEmployee", () => {
  it("publishes command and returns accepted", async () => {
    const r = await createEmployee(ctx(), {
      employeeNo: "EMP001", fullName: "Test", departmentId: randomUUID(),
      designationId: randomUUID(), dateOfJoining: "2026-01-01",
      employeeType: "permanent" as any, basicMinor: 5000000n, currency: "INR",
    } as any);
    expect(r.status).toBe("accepted");
    expect(r.id).toBeDefined();
    expect(publishMock).toHaveBeenCalledOnce();
    expect(putMock).toHaveBeenCalledOnce();
  });
});

describe("confirmEmployee", () => {
  it("publishes confirm command", async () => {
    const r = await confirmEmployee(ctx(), randomUUID(), { confirmationDate: "2026-06-01" } as any);
    expect(r.status).toBe("accepted");
    expect(publishMock).toHaveBeenCalledOnce();
    expect(invalidateMock).toHaveBeenCalledOnce();
  });
});

describe("transferEmployee", () => {
  it("publishes transfer command", async () => {
    const r = await transferEmployee(ctx(), randomUUID(), {
      fromDeptId: randomUUID(), toDeptId: randomUUID(), effectiveDate: "2026-07-01",
    } as any);
    expect(r.status).toBe("accepted");
    expect(publishMock).toHaveBeenCalledOnce();
  });
});

describe("submitTransferForApproval", () => {
  it("publishes transfer submit-approval command", async () => {
    const r = await submitTransferForApproval(ctx(), randomUUID(), {
      fromDeptId: randomUUID(), toDeptId: randomUUID(), effectiveDate: "2026-07-01",
    } as any);
    expect(r.status).toBe("accepted");
    expect(r.id).toBeDefined(); // new transfer ID
    expect(publishMock).toHaveBeenCalledOnce();
  });
});

describe("submitPromotionForApproval", () => {
  it("publishes promotion submit-approval command", async () => {
    const r = await submitPromotionForApproval(ctx(), randomUUID(), {
      fromDesigId: randomUUID(), toDesigId: randomUUID(), effectiveDate: "2026-08-01",
    } as any);
    expect(r.status).toBe("accepted");
    expect(r.id).toBeDefined();
    expect(publishMock).toHaveBeenCalledOnce();
  });
});

describe("separateEmployee", () => {
  it("publishes separate command", async () => {
    const r = await separateEmployee(ctx(), randomUUID(), {
      separationType: "retirement", effectiveDate: "2026-06-30", encashmentDays: 200,
    } as any);
    expect(r.status).toBe("accepted");
    expect(publishMock).toHaveBeenCalledOnce();
  });
});

describe("updateEmployee", () => {
  it("publishes update command", async () => {
    const r = await updateEmployee(ctx(), randomUUID(), {
      mobile: "9876543210", email: "x@gov.in",
    } as any);
    expect(r.status).toBe("accepted");
    expect(publishMock).toHaveBeenCalledOnce();
  });
});
