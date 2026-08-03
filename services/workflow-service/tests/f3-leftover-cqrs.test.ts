import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../src/modules/", import.meta.url);
const modules = ["delegations", "authority", "finalization", "quorum", "sla", "deviations", "workbaskets"];

describe("F3 leftover workflow CQRS route boundary", () => {
  it.each(modules)("%s mutation routes contain no direct Drizzle / mutating repo writes", async (module) => {
    const source = await readFile(new URL(`${module}/routes.ts`, ROOT), "utf8");
    expect(source).not.toMatch(/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/);
    expect(source).not.toMatch(/db\.transaction/);
    expect(source).toContain("sendAccepted");
  });

  it("delegation consumer markProcessed precedes insert", async () => {
    const source = await readFile(new URL("delegations/consumer.ts", ROOT), "utf8");
    expect(source.indexOf("markProcessed")).toBeLessThan(source.indexOf("repo.create"));
  });
});
