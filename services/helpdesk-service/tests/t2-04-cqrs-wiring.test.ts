import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const publish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publish(...args) },
  cache: { invalidate: vi.fn(), makeKey: (...parts: string[]) => parts.join(":") },
}));

const ctx = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  correlationId: "corr-t2-04",
  roles: ["helpdesk_admin"],
};

describe("T2-04 helpdesk automation + sla CQRS", () => {
  beforeEach(() => publish.mockClear());

  it("automation routes have zero db.transaction", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/automation/routes.ts"), "utf8");
    expect(src).not.toMatch(/db\.transaction/);
    expect(src).toMatch(/commands\./);
  });

  it("sla routes have zero db.transaction", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/sla/routes.ts"), "utf8");
    expect(src).not.toMatch(/db\.transaction/);
  });

  it("automation createRule publishes", async () => {
    const { createRule } = await import("../src/modules/automation/commands.js");
    const res = await createRule(ctx as never, {
      name: "r1",
      ordinal: 1,
      trigger: { type: "field_match", field: "priority", value: "High" },
      actions: [{ type: "escalate", level: 1 }],
    });
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalled();
  });

  it("worker registers automation + sla consumers", () => {
    const src = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(src).toMatch(/registerAutomationConsumers/);
    expect(src).toMatch(/registerSlaConsumers/);
  });
});
