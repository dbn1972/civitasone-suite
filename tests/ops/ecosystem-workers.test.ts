import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const eco = readFileSync(join(__dirname, "../../ecosystem.config.js"), "utf8");

describe("ecosystem workers (FE↔BE CQRS)", () => {
  it("points court worker at dist/worker-main.js", () => {
    const m = eco.match(/worker\("court"[^)]*\)/);
    expect(m?.[0]).toContain("worker-main");
  });

  it("declares visitor-worker and works-worker", () => {
    expect(eco).toMatch(/worker\("visitor"/);
    expect(eco).toMatch(/worker\("works"/);
  });
});
