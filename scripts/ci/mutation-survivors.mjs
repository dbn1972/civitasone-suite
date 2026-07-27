#!/usr/bin/env node
/**
 * mutation-survivors.mjs — list surviving mutants for one file, grouped by
 * mutator and line, so a burn-down can target real gaps instead of guessing.
 *
 * Usage: node scripts/ci/mutation-survivors.mjs [fileSubstring] [limit]
 */
import { readFileSync } from "node:fs";

const [, , filter = "payroll/domain", limitArg = "40"] = process.argv;
const limit = Number(limitArg);

const report = JSON.parse(readFileSync("reports/mutation/mutation-report.json", "utf8"));

const rows = [];
for (const [path, file] of Object.entries(report.files ?? {})) {
  if (path.includes(filter) === false) continue;
  for (const m of file.mutants) {
    if (m.status !== "Survived" && m.status !== "NoCoverage") continue;
    rows.push({
      status: m.status,
      mutator: m.mutatorName,
      line: m.location?.start?.line ?? 0,
      replacement: (m.replacement ?? "").replace(/\s+/g, " ").slice(0, 60),
    });
  }
}

if (rows.length === 0) {
  console.log(`no surviving/uncovered mutants matching "${filter}"`);
  process.exit(0);
}

const byMutator = {};
for (const r of rows) {
  byMutator[r.mutator] = (byMutator[r.mutator] ?? 0) + 1;
}

console.log(`file filter: ${filter}`);
console.log(`survived + no-coverage: ${rows.length}`);
console.log("");
console.log("by mutator:");
for (const [k, v] of Object.entries(byMutator).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
console.log("");
console.log(`first ${Math.min(limit, rows.length)} by line:`);
rows.sort((a, b) => a.line - b.line);
for (const r of rows.slice(0, limit)) {
  console.log(
    `  L${String(r.line).padStart(4)}  ${r.status.padEnd(11)} ${r.mutator.padEnd(22)} -> ${r.replacement}`,
  );
}
