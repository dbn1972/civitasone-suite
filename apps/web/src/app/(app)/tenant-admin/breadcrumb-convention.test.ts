/**
 * GAP-TENANT-ADMIN-USERS-06: every tenant-admin page shows exactly ONE breadcrumb
 * trail - the global AutoBreadcrumb in the app shell. A page-local <Breadcrumb> (or
 * a `back="/tenant-admin"` link that duplicates the trail's first crumb) would make
 * the page show two. Detail pages ([id]) may keep `back` to their LIST page, because
 * the global trail cannot link an intermediate list route.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = __dirname;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const pages = walk(ROOT).filter((f) => /(?:^|[\\/])(?:page|not-found)\.tsx$/.test(f));

describe("tenant-admin breadcrumb convention", () => {
  it("scans the real pages", () => {
    expect(pages.length).toBeGreaterThan(25);
  });

  it.each(pages.map((f) => [relative(ROOT, f), f] as const))("%s has no page-local Breadcrumb", (_name, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/<Breadcrumb\b/);
    expect(src).not.toMatch(/from\s+["'][^"']*\/Breadcrumb["']/);
  });

  it.each(pages.map((f) => [relative(ROOT, f), f] as const))("%s does not duplicate the trail's root with back=\"/tenant-admin\"", (_name, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/\bback="\/tenant-admin"/);
  });
});
