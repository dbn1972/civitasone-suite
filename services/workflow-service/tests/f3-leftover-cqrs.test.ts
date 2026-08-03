import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../src/modules/", import.meta.url);
const modules = [
  "delegations", "authority", "finalization", "quorum", "sla", "deviations", "workbaskets",
  "case-links", "checklists", "comments",
];

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

  it("case-links / checklists / comments consumers markProcessed before mutating repo calls", async () => {
    const markers: Record<string, string> = {
      "case-links": "repo.createLinkChecked",
      checklists: "repo.upsertTemplate",
      comments: "repo.add",
    };
    for (const [mod, marker] of Object.entries(markers)) {
      const source = await readFile(new URL(`${mod}/consumer.ts`, ROOT), "utf8");
      expect(source.indexOf("markProcessed")).toBeGreaterThan(-1);
      expect(source.indexOf("markProcessed")).toBeLessThan(source.indexOf(marker));
    }
  });

  it("worker registers leftover consumers", async () => {
    const worker = await readFile(new URL("../worker.ts", ROOT), "utf8");
    expect(worker).toContain("registerCaseLinksConsumers");
    expect(worker).toContain("registerChecklistConsumers");
    expect(worker).toContain("registerCommentsConsumers");
  });
});
