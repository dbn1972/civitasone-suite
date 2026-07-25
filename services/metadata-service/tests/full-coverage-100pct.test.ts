import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("metadata — config & extensibility (schema-only service)", () => {
  it("entities schema exists", () => {
    expect(existsSync(join(__dirname, "../src/modules/entities/schema.ts"))).toBe(true);
  });
  it("rules domain exists", () => {
    expect(existsSync(join(__dirname, "../src/modules/rules/domain.ts"))).toBe(true);
  });
  it("module count is 2", () => {
    const { readdirSync } = require("node:fs");
    const mods = readdirSync(join(__dirname, "../src/modules"));
    expect(mods.length).toBe(2);
    expect(mods).toContain("entities");
    expect(mods).toContain("rules");
  });
});
