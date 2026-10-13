import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// SF-02/SF-03 guard (no baseline file). Fails on:
//  1. a new `mapped.length > 0 ? mapped : null` (an empty list is not a failed
//     fetch; fetchJson turns a null mapper result into source:"error").
//  2. a `notFound()` call whose enclosing function has no `404` status check
//     (a transient 5xx/network failure must show an error state, not a 404).
const SRC = join(__dirname, "..", "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC);

// notFound() callers that are not driven by a fetch result: static lookups
// (config tables, slugs, feature flags) where "unknown key" genuinely IS a 404.
// A comment is required for every entry. Do not add fetch-driven pages here.
const NOT_FOUND_ALLOW: Record<string, string> = {
  "app/(app)/help/[module]/page.tsx": "static help-module registry lookup",
  "app/(app)/municipal/[serviceKey]/applications/page.tsx": "static municipal service config lookup",
  "app/(app)/municipal/[serviceKey]/layout.tsx": "static municipal service config lookup",
  "app/(app)/municipal/[serviceKey]/page.tsx": "static municipal service config lookup",
  "app/(app)/works/masters/page.tsx": "validates ?type against a static enum",
  "app/(marketing)/docs/[slug]/page.tsx": "static docs chapter list",
  "app/(app)/admin/tenants/[id]/page.tsx": "notFound() on a non-uuid id (pre-fetch validation); the fetched record is gated on status !== 404",
  "app/(app)/municipal/[serviceKey]/applications/[id]/page.tsx": "static service config lookup; the fetched record is gated on status === 404",
  "app/auth/dev/page.tsx": "dev-login feature flag",
  "app/careers/[id]/page.tsx": "getVacancy returns an explicit status:\"notfound\" discriminant",
  "app/(app)/citizen/services/[serviceKey]/page.tsx": "classifyServiceLoad(): not_found is 404/403 only; 5xx is 'unavailable'",
  "app/(app)/citizen/services/[serviceKey]/apply/page.tsx": "classifyServiceLoad(): not_found is 404/403 only; 5xx is 'unavailable'",
};

describe("SF-03 guard: no empty-list-to-null mapper", () => {
  it("has no `mapped.length > 0 ? mapped : null`", () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/mapped\.length\s*>\s*0\s*\?\s*mapped\s*:\s*null/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
            offenders.push(`${relative(SRC, f)}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("SF-02 guard: notFound() only after a 404 status check", () => {
  it("every notFound() call has a 404 check in the same function or is allow-listed", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f);
      const text = readFileSync(f, "utf8");
      if (!/\bnotFound\(\)/.test(text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) continue;
      if (rel in NOT_FOUND_ALLOW) continue;
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!/\bnotFound\(\)/.test(line) || /^\s*(\/\/|\*)/.test(line) || /import\s/.test(line)) return;
        // Enclosing function = from the nearest preceding top-level-ish
        // function declaration (or file start) to this line.
        let start = 0;
        for (let j = i; j >= 0; j--) {
          if (/^(export\s+)?(default\s+)?(async\s+)?function\b|^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(lines[j]!)) {
            start = j;
            break;
          }
        }
        const body = lines.slice(start, i + 1).join("\n");
        if (!/\b404\b/.test(body)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("allow-list entries still exist and still call notFound() (no stale entries)", () => {
    for (const rel of Object.keys(NOT_FOUND_ALLOW)) {
      const text = readFileSync(join(SRC, rel), "utf8");
      expect(/\bnotFound\(\)/.test(text), rel).toBe(true);
    }
  });
});
