import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("F3-B2 hrms CQRS", () => {
  it("lifecycle routes sync-writes=0", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/lifecycle/routes.ts"), "utf8");
    expect(src).not.toMatch(/\bdb\.(insert|update|delete|execute|transaction)\b/);
  });
  it("training routes sync-writes=0", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/training/routes.ts"), "utf8");
    expect(src).not.toMatch(/\bdb\.(insert|update|delete|execute|transaction)\b/);
  });
  it("loans routes sync-writes=0", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/employee/loans-routes.ts"), "utf8");
    expect(src).not.toMatch(/\bdb\.(insert|update|delete|execute|transaction)\b/);
  });
});
