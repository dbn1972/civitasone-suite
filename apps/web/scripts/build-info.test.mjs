// A-N2 (UAT post-b14): the footer "last updated" date is the build time,
// baked in by next.config.mjs as NEXT_PUBLIC_BUILD_TIME.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTimeIso } from "./build-info.mjs";

const NOW = new Date("2030-01-01T00:00:00.000Z");

describe("buildTimeIso", () => {
  it("uses BUILD_TIME when it is a valid date (CI can pin it)", () => {
    expect(buildTimeIso({ BUILD_TIME: "2026-11-04T10:00:00Z" }, NOW)).toBe("2026-11-04T10:00:00.000Z");
  });

  it("falls back to SOURCE_DATE_EPOCH (reproducible builds)", () => {
    expect(buildTimeIso({ SOURCE_DATE_EPOCH: "1793750400" }, NOW)).toBe(new Date(1793750400 * 1000).toISOString());
  });

  it("otherwise uses the clock at build time", () => {
    expect(buildTimeIso({}, NOW)).toBe("2030-01-01T00:00:00.000Z");
  });

  it("ignores unparseable values instead of baking in garbage", () => {
    expect(buildTimeIso({ BUILD_TIME: "yesterday", SOURCE_DATE_EPOCH: "abc" }, NOW)).toBe("2030-01-01T00:00:00.000Z");
  });

  it("is wired into next.config.mjs as NEXT_PUBLIC_BUILD_TIME", () => {
    const cfg = readFileSync(join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..", "next.config.mjs"), "utf8");
    expect(cfg).toMatch(/import \{ buildTimeIso \} from ["\x27]\.\/scripts\/build-info\.mjs["\x27]/);
    expect(cfg).toMatch(/NEXT_PUBLIC_BUILD_TIME:\s*buildTimeIso\(\)/);
  });
});
