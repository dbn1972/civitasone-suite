import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../src/modules/application/", import.meta.url);

describe("F3 leftover citizen intake CQRS", () => {
  it("intake-routes has no sync Drizzle writes and uses sendAccepted", async () => {
    const source = await readFile(new URL("intake-routes.ts", ROOT), "utf8");
    expect(source).not.toMatch(/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/);
    expect(source).not.toMatch(/db\.transaction/);
    expect(source).toContain("sendAccepted");
    expect(source).toContain("commands.saveDraft");
    expect(source).toContain("commands.submitDraft");
  });

  it("intake.ts is query-only", async () => {
    const source = await readFile(new URL("intake.ts", ROOT), "utf8");
    expect(source).not.toMatch(/db\.transaction/);
    expect(source).not.toMatch(/insertDraft|updateDraft/);
  });

  it("consumer markProcessed precedes draft writes", async () => {
    const source = await readFile(new URL("consumer.ts", ROOT), "utf8");
    const saveIdx = source.indexOf("COMMANDS.draftSave");
    const mp = source.indexOf("markProcessed", saveIdx);
    const insert = source.indexOf("intakeRepo.insertDraft", saveIdx);
    expect(mp).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(mp);
  });
});
