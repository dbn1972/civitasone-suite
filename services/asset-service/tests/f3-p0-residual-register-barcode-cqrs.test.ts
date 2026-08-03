import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules/register");
const TOPICS = join(__dirname, "../src/topics.ts");

describe("F3 P0 residual asset register barcode CQRS", () => {
  it("commands/routes have zero sync db.transaction for barcode", () => {
    for (const rel of ["routes.ts", "commands.ts"]) {
      const src = readFileSync(join(MOD, rel), "utf8");
      expect(src).not.toMatch(/await\s+db\.transaction/);
      expect(src).not.toContain("code(201)");
    }
    const commands = readFileSync(join(MOD, "commands.ts"), "utf8");
    expect(commands).toContain("assetTagBarcode");
    expect(commands).toContain("queue.publish");
  });

  it("topics + consumer wire assetTagBarcode with markProcessed", () => {
    const topics = readFileSync(TOPICS, "utf8");
    expect(topics).toContain("assetTagBarcode");
    const consumer = readFileSync(join(MOD, "consumer.ts"), "utf8");
    expect(consumer).toContain("COMMANDS.assetTagBarcode");
    expect(consumer).toContain("markProcessed");
    expect(consumer).toContain("updateAssetBarcode");
  });
});
