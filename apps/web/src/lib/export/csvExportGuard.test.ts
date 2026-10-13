import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * W1 SF-08 ratchet (no baseline): every CSV file that leaves the browser must be
 * built by `downloadCsvFile` in lib/export/csvExport.ts, so the export path (and
 * its audit) cannot be bypassed by a hand-rolled `new Blob([csv], ...)`. Non-CSV
 * blobs (JSON snapshots, images, beacons) are not affected.
 */
const SRC = resolve(__dirname, "../..");
const ALLOWED = new Set(["lib/export/csvExport.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("no CSV Blob outside the shared helper", () => {
  it("finds no `new Blob(` CSV export outside lib/export/csvExport.ts", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      let i = text.indexOf("new Blob(");
      while (i !== -1) {
        const stmt = text.slice(i, i + 220);
        if (/csv/i.test(stmt)) offenders.push(rel);
        i = text.indexOf("new Blob(", i + 1);
      }
    }
    expect(offenders, "build CSV downloads with downloadCsvFile()/runAuditedCsvExport() from @/lib/export/csvExport").toEqual([]);
  });
});
