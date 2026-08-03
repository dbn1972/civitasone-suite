import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../src");

describe("F3 P0 UC validation CQRS", () => {
  it("uc-validation route has zero sync writes", () => {
    const src = readFileSync(join(SRC, "modules/uc-validation/routes.ts"), "utf8");
    expect(src).not.toMatch(/await\s+db\.transaction/);
    expect(src).not.toMatch(/insertUcValidation/);
    expect(src).not.toMatch(/setUcValidationStatus/);
    expect(src).toContain("sendAccepted");
    expect(src).toContain("validateUc");
  });

  it("utilisation consumer handles ucValidate with markProcessed", () => {
    const src = readFileSync(join(SRC, "modules/utilisation/consumer.ts"), "utf8");
    expect(src).toContain("COMMANDS.ucValidate");
    expect(src).toContain("markProcessed");
    expect(src).toContain("insertUcValidation");
    expect(src).toContain("setUcValidationStatus");
  });
});
