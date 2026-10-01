import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

// GAP-HR-LEAVE-ALLOCATE-06: "Back to Leave"/"Back to HR" were hard-coded
// English across the leave pages and their error boundaries.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("leave pages back labels are translated", () => {
  it("has the shared common keys in en and hi", () => {
    for (const m of [en, hi] as Array<{ common: Record<string, string> }>) {
      expect(m.common.backToLeave).toBeTruthy();
      expect(m.common.backToHr).toBeTruthy();
    }
    expect(hi.common.backToLeave).not.toBe(en.common.backToLeave);
  });

  it("no leave page/loading/error source hard-codes a Back-to label", () => {
    const offenders = walk(__dirname)
      .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f))
      .filter((f) => /backLabel="Back to /.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
