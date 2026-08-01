import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("visitor worker outbox relay uses scannerDb", () => {
  const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");

  it("calls startRelay with scannerDb", () => {
    expect(src).toMatch(/startRelay\(\s*scannerDb/);
  });

  it("does not call startRelay(db, …) for the primary relay", () => {
    expect(src).not.toMatch(/startRelay\(\s*db\s*,/);
  });
});
