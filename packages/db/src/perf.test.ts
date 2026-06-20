import { describe, it, expect } from "vitest";
import { assertP95, assertIndexUsed } from "../src/perf.js";

describe("@civitasone/db perf harness", () => {
  it("assertP95 passes when fn is fast", async () => {
    await assertP95(async () => { /* noop */ }, { p95Ms: 50, samples: 10, warmup: 2 });
  });

  it("assertIndexUsed accepts index scan plans", () => {
    expect(() => assertIndexUsed("Index Scan using idx_foo on table")).not.toThrow();
  });

  it("assertIndexUsed rejects seq scan only plans", () => {
    expect(() => assertIndexUsed("Seq Scan on huge_table")).toThrow();
  });
});
