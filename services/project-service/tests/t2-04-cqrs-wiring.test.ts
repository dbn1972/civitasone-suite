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
  roles: ["project_manager"],
};

describe("T2-04 project board-intake + evidence + scheduling CQRS", () => {
  beforeEach(() => publish.mockClear());

  it("board-intake routes have zero db.transaction", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/board-intake/routes.ts"), "utf8");
    expect(src).not.toMatch(/db\.transaction/);
  });

  it("evidence routes have zero repo.insert write", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/evidence/routes.ts"), "utf8");
    expect(src).not.toMatch(/repo\.insert\(/);
    expect(src).toMatch(/commands\.attachEvidence/);
  });

  it("scheduling routes have zero tenantTransaction", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/scheduling/routes.ts"), "utf8");
    expect(src).not.toMatch(/tenantTransaction/);
    expect(src).not.toMatch(/db\.transaction/);
  });

  it("acceptIntake publishes", async () => {
    const { acceptIntake } = await import("../src/modules/board-intake/commands.js");
    const res = await acceptIntake(ctx as never, "00000000-0000-4000-8000-000000000099");
    expect(res.status).toBe("accepted");
    expect(publish).toHaveBeenCalled();
  });

  it("worker registers evidence + scheduling consumers", () => {
    const src = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(src).toMatch(/registerEvidenceConsumers/);
    expect(src).toMatch(/registerSchedulingConsumers/);
  });
});
