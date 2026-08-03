import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../src/modules/", import.meta.url);
const routes = ["definitions", "dmn", "bpmn", "admin", "assignment", "decisions"];

describe("F3 batch 1 CQRS route boundary", () => {
  it.each(routes)("%s mutation routes contain no direct Drizzle writes", async (module) => {
    const source = await readFile(new URL(`${module}/routes.ts`, ROOT), "utf8");
    expect(source).not.toMatch(/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/);
    expect(source).not.toMatch(/db\.transaction/);
    expect(source).toContain("sendAccepted");
  });

  it("definition create consumer deduplicates before inserting in one transaction", async () => {
    const source = await readFile(new URL("definitions/consumer.ts", ROOT), "utf8");
    const createStart = source.indexOf("COMMANDS.createDefinition");
    const createHandler = source.slice(createStart, source.indexOf("COMMANDS.deployDefinition"));
    expect(createHandler).toContain("db.transaction");
    expect(createHandler.indexOf("markProcessed")).toBeLessThan(createHandler.indexOf("tx.insert(definitions)"));
    expect(createHandler).toContain("EVENTS.definitionCreated");
  });
});
