/**
 * The allotment lifecycle commands are published by the routes; they only take effect if the worker
 * subscribes the consumers. (GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: it never did.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("estab worker wiring", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "src", "worker.ts"), "utf8");
  it("imports and registers the quarters consumers", () => {
    expect(src).toMatch(/import \{ registerQuarterConsumers \} from "\.\/modules\/quarters\/consumer\.js"/);
    expect(src).toMatch(/^registerQuarterConsumers\(queue\);$/m);
  });
});
