import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules/register");
const TOPICS = join(__dirname, "../src/topics.ts");

describe("F3 P0 residual asset register barcode CQRS", () => {
  it("commands/routes have zero sync db.transaction for barcode", () => {
    // routes.ts also hosts unrelated synchronous category-CRUD endpoints
    // (added by the G1-G18 gap-closure work, see commit 58344045) that
    // legitimately use db.transaction/code(201) for simple master-data
    // writes — this check only cares about the barcode route specifically,
    // so it's scoped to that one handler rather than the whole file.
    const routesSrc = readFileSync(join(MOD, "routes.ts"), "utf8");
    const barcodeHandler = routesSrc.match(
      /app\.patch\(\s*["']\/v1\/assets\/assets\/:id\/barcode["'][\s\S]*?\n\s*\}\);/,
    )?.[0];
    expect(barcodeHandler, "barcode route handler not found in routes.ts").toBeTruthy();
    expect(barcodeHandler).not.toMatch(/await\s+db\.transaction/);
    expect(barcodeHandler).not.toContain("code(201)");

    const commands = readFileSync(join(MOD, "commands.ts"), "utf8");
    expect(commands).not.toMatch(/await\s+db\.transaction/);
    expect(commands).not.toContain("code(201)");
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
