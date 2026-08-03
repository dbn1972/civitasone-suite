import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const publish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publish(...args) },
  cache: {
    invalidate: vi.fn(),
    put: vi.fn(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

const ctx = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  correlationId: "corr-t2-04",
  roles: ["citizen_admin"],
};

describe("T2-04 citizen fee-payment + issuance CQRS", () => {
  beforeEach(() => publish.mockClear());

  it("fee-payment commands publish (no writes in commands)", async () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/fee-payment/commands.ts"), "utf8");
    expect(src).not.toMatch(/db\.(insert|update|delete)/);
    expect(src).not.toMatch(/repo\.(insert|update)/);
    expect(src).toMatch(/queue\.publish/);
    const { createSchedule } = await import("../src/modules/fee-payment/commands.js");
    const res = await createSchedule(ctx as never, {
      serviceId: "00000000-0000-4000-8000-000000000010",
      name: "Standard",
      baseAmount: 10000,
      currency: "INR",
      exemptions: [],
    });
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalled();
  });

  it("issuance commands publish", async () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/issuance/commands.ts"), "utf8");
    expect(src).not.toMatch(/db\.(insert|update|delete)/);
    expect(src).not.toMatch(/repo\.(insert|update)/);
    const { requestIssuance } = await import("../src/modules/issuance/commands.js");
    const res = await requestIssuance(ctx as never, {
      certType: "birth",
      subject: { name: "A" },
      payload: {},
    });
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalled();
  });

  it("worker registers fee + issuance consumers", () => {
    const src = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(src).toMatch(/registerFeePaymentConsumers/);
    expect(src).toMatch(/registerIssuanceConsumers/);
  });
});
