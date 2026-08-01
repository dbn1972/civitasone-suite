#!/usr/bin/env node
/**
 * Parse docs/BHARAT-SAMPARK-RTM.md and report status counts.
 *
 * Why parse instead of grep: a plain grep of the status strings also matches the
 * Status Legend rows and any prose mentioning a status, which overcounts. This
 * only counts rows inside a requirement table (6 pipe-delimited cells whose
 * first cell is a requirement id, not a header or separator).
 */
import { readFile } from "node:fs/promises";

const path = process.argv[2] ?? "docs/BHARAT-SAMPARK-RTM.md";
const text = await readFile(path, "utf8");

const STATUSES = ["DONE", "PARTIAL", "NEW", "ADAPTER"];
const counts = new Map(STATUSES.map((s) => [s, 0]));
const rows = [];
let section = "(none)";

for (const line of text.split("\n")) {
  const heading = /^#{2,3}\s+(.*)$/.exec(line);
  if (heading?.[1]) {
    section = heading[1].trim();
    continue;
  }
  if (!line.startsWith("|")) continue;

  const cells = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length < 4) continue;

  const id = cells[0];
  if (!id || id === "Req ID" || /^:?-{2,}/.test(id)) continue;

  // Column order is NOT uniform across this document: the Section 7/26 tables are
  // | Req ID | Requirement | Status | Service | Module | Gap | while Appendix D is
  // | Req ID | Status | Service | Gap |. Locate the status cell by content, not index.
  const statusIdx = cells.findIndex((c) => STATUSES.some((s) => c.includes(s)));
  if (statusIdx === -1) continue;
  const matched = STATUSES.find((s) => (cells[statusIdx] ?? "").includes(s));
  if (!matched) continue;

  counts.set(matched, (counts.get(matched) ?? 0) + 1);
  rows.push({
    id,
    requirement: statusIdx > 1 ? (cells[1] ?? "") : "",
    status: matched,
    service: cells[statusIdx + 1] ?? "",
    section,
  });
}

const total = rows.length;
console.log(`Itemised rows: ${total}\n`);
for (const s of STATUSES) {
  const n = counts.get(s) ?? 0;
  console.log(`  ${s.padEnd(8)} ${String(n).padStart(4)}  ${((n / total) * 100).toFixed(0)}%`);
}

const open = rows.filter((r) => r.status !== "DONE");
console.log(`\nOpen rows: ${open.length}\n`);

const bySection = new Map();
for (const r of open) {
  const list = bySection.get(r.section) ?? [];
  list.push(r);
  bySection.set(r.section, list);
}
for (const [sec, list] of [...bySection].sort((a, b) => b[1].length - a[1].length)) {
  const breakdown = STATUSES.slice(1)
    .map((s) => `${s}:${list.filter((r) => r.status === s).length}`)
    .filter((p) => !p.endsWith(":0"))
    .join(" ");
  console.log(`  ${String(list.length).padStart(3)}  ${sec}  [${breakdown}]`);
}

const svc = new Map();
for (const r of open) {
  for (const name of r.service.matchAll(/([a-z-]+)-service/g)) {
    const key = name[1] ?? "";
    svc.set(key, (svc.get(key) ?? 0) + 1);
  }
}
console.log(`\nOpen rows by service touched:\n`);
for (const [name, n] of [...svc].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${name}`);
}
