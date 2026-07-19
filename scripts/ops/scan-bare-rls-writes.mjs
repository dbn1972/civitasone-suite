#!/usr/bin/env node
// scripts/ops/scan-bare-rls-writes.mjs
//
// Scans every services/*/src/modules/**/*.ts file for `db.insert(`,
// `db.update(`, `db.delete(`, AND `db.select(` calls that are NOT lexically
// inside a `db.transaction(...)` (or `scopedRead`/`scopedWrite`/
// `runWithTenant`) call's argument span. Under `wrapWithTenantGuc`
// (packages/db/src/wrap-tenant-db.ts), only `db.transaction()` calls get
// `app.tenant_id` GUC injected — a bare `db.insert()`/`db.update()`/
// `db.delete()`/`db.select()` runs on a connection with no GUC set, and
// fails RLS write policies OR (for a bare select under FORCE ROW LEVEL
// SECURITY) silently returns zero rows instead of erroring, which is even
// more dangerous because it doesn't crash — it just looks like empty data.
//
// Approach: tokenize the file character-by-character (skipping string/
// template-literal/comment contents so braces/parens inside them don't
// corrupt matching), track every top-level call to `db.transaction(` and
// compute its exact [start, end) character span by matching parens, then
// flag any `db.insert(`/`db.update(`/`db.delete(`/`db.select(` call whose
// start offset does not fall inside any recorded protected span. This is a
// real paren-matching scan (not a brace-depth backward-walk heuristic),
// so it is not fooled by object literals, arrow-function bodies, or route
// handler callbacks the way a line-based heuristic would be.
//
// Usage: node scripts/ops/scan-bare-rls-writes.mjs [--json] [--writes-only]

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

function listTsFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".turbo") continue;
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strips the contents of string literals ('...', "...", `...`), regex
 * literals (best-effort), and comments (// and /* *\/) by replacing their
 * interior characters with spaces, PRESERVING every other character's
 * exact offset (so line/column math and paren-matching on the returned
 * string still line up 1:1 with the original source). This is what makes
 * the subsequent paren-matching robust against `"db.transaction("` inside
 * a string, or a `{` inside a comment.
 */
function maskNonCode(text) {
  const out = text.split("");
  let i = 0;
  const n = out.length;
  while (i < n) {
    const c = out[i];
    if (c === "/" && out[i + 1] === "/") {
      let j = i;
      while (j < n && out[j] !== "\n") {
        out[j] = out[j] === "\n" ? "\n" : " ";
        j++;
      }
      i = j;
      continue;
    }
    if (c === "/" && out[i + 1] === "*") {
      let j = i + 2;
      while (j < n - 1 && !(out[j] === "*" && out[j + 1] === "/")) {
        if (out[j] !== "\n") out[j] = " ";
        j++;
      }
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n && out[j] !== quote) {
        if (out[j] === "\\") {
          if (out[j] !== "\n") out[j] = " ";
          j++;
          if (j < n && out[j] !== "\n") out[j] = " ";
          j++;
          continue;
        }
        if (out[j] !== "\n") out[j] = " ";
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Given `maskedText` (same length/offsets as the original source, with
 * string/comment interiors blanked) and a starting offset that points at
 * the `(` immediately following a call name (e.g. right after
 * `db.transaction`), returns the offset one past the matching closing `)`.
 */
function findMatchingParenEnd(maskedText, openParenOffset) {
  let depth = 0;
  for (let i = openParenOffset; i < maskedText.length; i++) {
    const c = maskedText[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return maskedText.length;
}

const TRANSACTION_NAME_RE = /\b(?:db|tx)\.transaction\s*\(/g;
const SCOPED_HELPER_NAME_RE = /\b(?:scopedRead|scopedWrite|runWithTenant)\s*\(/g;
const WRITES_ONLY = process.argv.includes("--writes-only");
// `\s*` between `db` and `.` handles the common "db\n  .select(...)" chained
// call style (method call on its own line), not just `db.select(`. Also
// catches `selectDistinct` (a real distinct read variant, same RLS exposure
// as `select`).
const WRITE_CALL_RE = WRITES_ONLY
  ? /\bdb\s*\.\s*(insert|update|delete)\s*\(/g
  : /\bdb\s*\.\s*(insert|update|delete|selectDistinct|select)\s*\(/g;

function computeProtectedSpans(maskedText) {
  const spans = [];
  for (const re of [TRANSACTION_NAME_RE, SCOPED_HELPER_NAME_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(maskedText)) !== null) {
      const openParenOffset = match.index + match[0].length - 1;
      const end = findMatchingParenEnd(maskedText, openParenOffset);
      spans.push([match.index, end]);
    }
  }
  return spans;
}

function offsetToLineCol(text, offset) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: offset - lastNewline };
}

function scanFile(path) {
  const text = readFileSync(path, "utf8");
  const masked = maskNonCode(text);
  const protectedSpans = computeProtectedSpans(masked);

  const findings = [];
  WRITE_CALL_RE.lastIndex = 0;
  let match;
  while ((match = WRITE_CALL_RE.exec(masked)) !== null) {
    const offset = match.index;
    const isProtected = protectedSpans.some(([start, end]) => offset > start && offset < end);
    if (isProtected) continue;

    const { line } = offsetToLineCol(text, offset);
    const lineText = text.split(/\r?\n/)[line - 1]?.trim() ?? "";
    findings.push({ line, kind: match[1], text: lineText });
  }
  return findings;
}

function main() {
  const jsonOutput = process.argv.includes("--json");
  const serviceDirs = readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith("-service"))
    .map((e) => e.name)
    .sort();

  const report = [];
  let totalFindings = 0;

  for (const serviceDir of serviceDirs) {
    const modulesDir = join(SERVICES_DIR, serviceDir, "src", "modules");
    const files = listTsFiles(modulesDir);
    const serviceFindings = [];

    for (const file of files) {
      const findings = scanFile(file);
      if (findings.length > 0) {
        serviceFindings.push({ file: relative(REPO_ROOT, file), findings });
        totalFindings += findings.length;
      }
    }

    if (serviceFindings.length > 0) {
      report.push({ service: serviceDir, files: serviceFindings });
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ totalFindings, services: report }, null, 2));
    return;
  }

  console.log(`Bare RLS-write scan: ${report.length} services, ${totalFindings} flagged call sites\n`);
  for (const svc of report) {
    console.log(`## ${svc.service} (${svc.files.reduce((n, f) => n + f.findings.length, 0)} findings)`);
    for (const f of svc.files) {
      console.log(`  ${f.file}`);
      for (const finding of f.findings) {
        console.log(`    L${finding.line} [${finding.kind}] ${finding.text}`);
      }
    }
    console.log("");
  }

  console.log(`TOTAL: ${totalFindings} flagged call sites across ${report.length} services`);
}

main();
