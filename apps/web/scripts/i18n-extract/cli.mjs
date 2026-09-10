#!/usr/bin/env node
// CLI for UX-004's extraction tool. Usage:
//   node scripts/i18n-extract/cli.mjs [--dir <path>] [--list] [--json]
//
// --dir   scope the scan to one subtree of src/app (default: src/app), e.g.
//         `--dir src/app/\(app\)/citizen` for a single hub.
// --list  print every finding (file:line — text), not just per-file counts.
// --json  print the raw findings array as JSON instead of a human summary.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(name);
}
function value(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const scanDir = path.resolve(webRoot, value("--dir", "src/app"));
const listMode = flag("--list");
const jsonMode = flag("--json");

const SKIP_DIRS = new Set(["node_modules", ".next", "__fixtures__"]);
const SKIP_FILE_RE = /\.(test|stories|spec)\.[jt]sx?$/;
const INCLUDE_EXT_RE = /\.(tsx|jsx)$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (INCLUDE_EXT_RE.test(entry.name) && !SKIP_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(scanDir);
const allFindings = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const rel = path.relative(webRoot, file);
  allFindings.push(...scanSource(rel, source));
}

if (jsonMode) {
  console.log(JSON.stringify(allFindings, null, 2));
  process.exit(0);
}

const byFile = new Map();
for (const f of allFindings) {
  byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
}

console.log(`UX-004 hardcoded-string scan — ${path.relative(webRoot, scanDir)}`);
console.log(`Files scanned: ${files.length}`);
console.log(`Files with hits: ${byFile.size}`);
console.log(`Total findings: ${allFindings.length}`);
console.log("");

if (listMode) {
  for (const f of allFindings) {
    const loc = f.kind === "prop" ? `${f.prop}=` : "text";
    console.log(`${f.file}:${f.line}  [${loc}]  ${f.text}`);
  }
} else {
  const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
  for (const [file, count] of sorted) {
    console.log(`${String(count).padStart(4)}  ${file}`);
  }
}
