import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../src/modules");

describe("F3 P0 residual estab spaces/bookRoom CQRS", () => {
  it("spaces routes/commands have zero 201 and no route-level db writes", () => {
    const routes = readFileSync(join(ROOT, "spaces/routes.ts"), "utf8");
    const cmds = readFileSync(join(ROOT, "spaces/commands.ts"), "utf8");
    expect(routes).not.toContain("code(201)");
    expect(routes).not.toMatch(/await\s+db\.transaction/);
    expect(routes).toContain("sendAccepted");
    expect(cmds).not.toContain("code(201)");
    expect(cmds).not.toMatch(/await\s+db\.transaction/);
    expect(cmds).toContain("queue.publish");
  });

  it("bookRoom publishes roomBook and returns accepted", () => {
    const cmds = readFileSync(join(ROOT, "facilities/commands.ts"), "utf8");
    const routes = readFileSync(join(ROOT, "facilities/routes.ts"), "utf8");
    expect(cmds).toContain("COMMANDS.roomBook");
    expect(cmds).not.toMatch(/await\s+db\.transaction/);
    expect(routes).not.toContain("code(201)");
    expect(routes).toContain("sendAccepted");
  });

  it("spaces consumer markProcessed", () => {
    const src = readFileSync(join(ROOT, "spaces/consumer.ts"), "utf8");
    expect(src).toContain("markProcessed");
    expect(src).toContain("spaceBuildingCreate");
  });
});
