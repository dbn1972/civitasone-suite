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
  correlationId: "corr-batch3",
  roles: ["citizen_admin"],
};

const BATCH3_MODULES = [
  "sla-rules",
  "appeal",
  "catalogue",
  "discovery",
  "documents",
  "eligibility",
] as const;

function modulePath(mod: string, file: string): string {
  return resolve(__dirname, `../src/modules/${mod}/${file}`);
}

describe("P0 F3 CQRS batch 3 — citizen-service modules", () => {
  beforeEach(() => publish.mockClear());

  for (const mod of BATCH3_MODULES) {
    it(`${mod}/commands.ts publishes without direct DB writes`, () => {
      const src = readFileSync(modulePath(mod, "commands.ts"), "utf8");
      expect(src).not.toMatch(/db\.(insert|update|delete|transaction)/);
      expect(src).toMatch(/queue\.publish/);
    });

    it(`${mod}/consumer.ts uses markProcessed`, () => {
      const src = readFileSync(modulePath(mod, "consumer.ts"), "utf8");
      expect(src).toMatch(/markProcessed/);
    });
  }

  it("sla-rules upsert publishes accepted", async () => {
    const { upsertRule } = await import("../src/modules/sla-rules/commands.js");
    const res = await upsertRule(ctx as never, {
      priority: "high", escalationHours: 24, escalateTo: "supervisor", isActive: true,
    });
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalled();
  });

  it("appeal file publishes accepted", async () => {
    const { fileAppeal } = await import("../src/modules/appeal/commands.js");
    const res = await fileAppeal(ctx as never, {
      appealType: "administrative",
      grounds: "test",
      decisionDate: new Date().toISOString().slice(0, 10),
      windowDays: 30,
    });
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalled();
  });

  it("worker registers batch 3 consumers", () => {
    const src = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(src).toMatch(/registerSlaRulesConsumers/);
    expect(src).toMatch(/registerAppealConsumers/);
    expect(src).toMatch(/registerCatalogueConsumers/);
    expect(src).toMatch(/registerDiscoveryConsumers/);
    expect(src).toMatch(/registerDocumentsConsumers/);
    expect(src).toMatch(/registerEligibilityConsumers/);
  });
});
