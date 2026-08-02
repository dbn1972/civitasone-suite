import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mods = ["fields", "rules", "records", "forms", "entities"];

describe("F3-B2 metadata CQRS", () => {
  for (const m of mods) {
    it(`${m} routes have zero sync drizzle writes`, () => {
      const src = readFileSync(resolve(__dirname, `../src/modules/${m}/routes.ts`), "utf8");
      expect(src).not.toMatch(/\bdb\.(insert|update|delete|execute|transaction)\b/);
      expect(src).not.toMatch(/tx\.(insert|update|delete)\s*\(/);
    });
  }
});
