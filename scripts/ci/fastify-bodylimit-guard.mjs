#!/usr/bin/env node
// -----------------------------------------------------------------------------
// fastify-bodylimit-guard.mjs -- every Fastify app declares a bounded request body
//
// WHY: GHSA-mrhx-c7xc-m3w5 (zod "can exhaust memory while validating oversized
// constrained collections") is fixed only in zod >= 4.6.6, while ~70 packages still run
// zod 3.x (3 -> 4 is a scheduled post-release major upgrade; see the dated entry in
// scripts/ci/cve-allowlist.json). The compensating control is that no HTTP service can be
// handed a request body large enough to build such a collection. Fastify's default is
// 1 MiB, but a default is invisible and silently lost if someone raises it; this guard
// makes the cap explicit and bounded.
//
// RULES (all under services/**/src, tests excluded):
//   1. Every `Fastify(...)` call must set `bodyLimit`, and its value must be statically
//      bounded: numeric literals only (underscores ok), max <= CAP. An expression that
//      reads process.env must be wrapped in Math.min(...) with a literal ceiling.
//   2. Every route-level `bodyLimit:` and every `addContentTypeParser(..., { bodyLimit })`
//      must resolve (literal, or a const defined in the same file / exported elsewhere
//      under services/) to a value <= CAP. Legitimate upload routes (careers resume
//      ~7 MB, form16 PDF 2 MiB) stay under the cap.
//   3. A `@fastify/multipart` registration must pass `limits`.
//
// Usage: node scripts/ci/fastify-bodylimit-guard.mjs   (from repo root; exit 1 on violation)
// -----------------------------------------------------------------------------
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const CAP_BYTES = 10 * 1024 * 1024; // 10 MiB: above the largest legit route (~7 MB resume upload)

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "tests", "__tests__", "coverage"]);

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && /\.(ts|mts|js|mjs)$/.test(ent.name) && !/\.(test|spec)\./.test(ent.name) && !ent.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Blank out comments and string contents so braces/parens inside them are ignored; offsets preserved. */
function mask(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && n === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += q;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += q;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const OPEN = new Set(["(", "{", "["]);
const CLOSE = new Set([")", "}", "]"]);

/** Index of the closer matching the opener at `open` in masked text (or -1). */
function matching(m, open) {
  let depth = 0;
  for (let i = open; i < m.length; i++) {
    if (OPEN.has(m[i])) depth++;
    else if (CLOSE.has(m[i])) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** End index of a value starting at `from` (stops at a top-level comma or the enclosing closer). */
function valueEnd(m, from, to) {
  let d = 0;
  let k = from;
  for (; k < to; k++) {
    const c = m[k];
    if (OPEN.has(c)) d++;
    else if (CLOSE.has(c)) {
      if (d === 0) break;
      d--;
    } else if (c === "," && d === 0) break;
  }
  return k;
}

/** Original-text value of top-level `key:` inside the options object spanning (from, to), else null. */
function propValue(orig, m, from, to, key) {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const ch = m[i];
    if (OPEN.has(ch)) depth++;
    else if (CLOSE.has(ch)) depth--;
    else if (depth === 1 && m.startsWith(key, i) && !/[\w$.]/.test(m[i - 1] ?? " ") && /^\s*:/.test(m.slice(i + key.length, i + key.length + 8))) {
      const j = m.indexOf(":", i) + 1;
      return orig.slice(j, valueEnd(m, j, to)).trim();
    }
  }
  return null;
}

/** Evaluate a numeric constant expression (digits, + - * / ( ), Math.ceil/min/max, identifiers via resolve). */
function evaluate(expr, resolve, depth = 0) {
  if (depth > 4) return null;
  let e = expr.replace(/\bas\s+const\b/g, "").trim();
  e = e.replace(/\b[A-Za-z_$][\w$]*\b/g, (id) => {
    if (["Math", "ceil", "min", "max", "floor"].includes(id)) return id;
    const def = resolve(id);
    if (def === null || def === undefined) return "\u0000";
    const v = evaluate(def, resolve, depth + 1);
    return v === null ? "\u0000" : String(v);
  });
  if (e.includes("\u0000")) return null;
  e = e.replace(/(\d)_(?=\d)/g, "$1");
  if (!/^[\d\s+\-*/().,]*$/.test(e.replace(/Math\.(ceil|min|max|floor)/g, ""))) return null;
  try {
    const v = Function(`"use strict"; return (${e});`)();
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Check one source file. `globalConsts(name)` resolves an exported const defined elsewhere.
 * Returns an array of { line, rule, msg }.
 */
export function checkSource(text, globalConsts = () => null, cap = CAP_BYTES) {
  const m = mask(text);
  const lineOf = (idx) => text.slice(0, idx).split("\n").length;
  const out = [];
  const localConst = (name) => {
    const re = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*(?::[^=\\n]+)?=\\s*([^;]+);`);
    const mm = re.exec(text);
    return mm ? mm[1] : globalConsts(name);
  };
  const fastifyRanges = [];

  for (const mm of m.matchAll(/\bFastify\s*\(/g)) {
    const open = mm.index + mm[0].length - 1;
    const close = matching(m, open);
    if (close < 0) continue;
    fastifyRanges.push([open, close]);
    const line = lineOf(mm.index);
    if (!/^\(\s*\{/.test(m.slice(open, close))) {
      out.push({ line, rule: "fastify-no-options", msg: "Fastify() must be called with an options object that sets bodyLimit" });
      continue;
    }
    const brace = m.indexOf("{", open);
    const val = propValue(text, m, brace, matching(m, brace), "bodyLimit");
    if (val === null) {
      out.push({ line, rule: "fastify-no-bodylimit", msg: "Fastify() without an explicit bodyLimit (relies on the invisible default)" });
      continue;
    }
    const usesEnv = /process\.env/.test(val);
    let bound = null;
    if (!usesEnv) {
      bound = evaluate(val, localConst);
    } else {
      // Env-driven: only acceptable when clamped by Math.min(<env expr>, <static ceiling>).
      const mi = val.indexOf("Math.min(");
      if (mi < 0) {
        out.push({ line, rule: "fastify-bodylimit-env-unclamped", msg: `bodyLimit reads process.env without a Math.min ceiling: ${val}` });
        continue;
      }
      const open2 = mi + "Math.min".length;
      const inner = val.slice(open2 + 1, matching(val, open2));
      const staticArgs = [];
      for (let p = 0; p < inner.length;) {
        const e = valueEnd(inner, p, inner.length);
        const arg = inner.slice(p, e).trim();
        if (arg && !/process|Number|\?\?|\|\|/.test(arg)) staticArgs.push(evaluate(arg, localConst));
        p = e + 1;
      }
      const ok = staticArgs.filter((x) => x !== null);
      bound = ok.length ? Math.min(...ok) : null;
    }
    if (bound === null) {
      out.push({ line, rule: "fastify-bodylimit-unbounded", msg: `bodyLimit has no statically resolvable bound: ${val}` });
    } else if (bound > cap) {
      out.push({ line, rule: "fastify-bodylimit-too-high", msg: `bodyLimit ${bound} exceeds cap ${cap}: ${val}` });
    }
  }

  // Route-level / parser-level bodyLimit (anything not inside a Fastify() options object).
  for (const mm of m.matchAll(/(?<![\w$.])bodyLimit\s*:/g)) {
    if (fastifyRanges.some(([a, b]) => mm.index > a && mm.index < b)) continue;
    const start = mm.index + mm[0].length;
    const val = text.slice(start, valueEnd(m, start, m.length)).trim();
    const v = evaluate(val, localConst);
    if (v === null) out.push({ line: lineOf(mm.index), rule: "route-bodylimit-unresolvable", msg: `cannot statically resolve bodyLimit: ${val}` });
    else if (v > cap) out.push({ line: lineOf(mm.index), rule: "route-bodylimit-too-high", msg: `bodyLimit ${v} exceeds cap ${cap}: ${val}` });
  }

  for (const mm of m.matchAll(/\.register\s*\(\s*(?:fastifyMultipart|multipart|fastify[A-Z]\w*Multipart)\b/g)) {
    const open = m.indexOf("(", mm.index);
    const close = matching(m, open);
    if (!/\blimits\b/.test(m.slice(open, close))) {
      out.push({ line: lineOf(mm.index), rule: "multipart-no-limits", msg: "@fastify/multipart registered without limits" });
    }
  }
  return out;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const files = walk(join(root, "services")).filter((f) => /\/src\//.test(f));
  const texts = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const globalConsts = (name) => {
    const re = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=\\n]+)?=\\s*([^;]+);`);
    for (const t of texts.values()) {
      const r = re.exec(t);
      if (r) return r[1];
    }
    return null;
  };
  let bad = 0;
  let apps = 0;
  for (const [f, t] of texts) {
    apps += (mask(t).match(/\bFastify\s*\(/g) ?? []).length;
    for (const v of checkSource(t, globalConsts)) {
      bad++;
      console.error(`${relative(root, f)}:${v.line}  [${v.rule}] ${v.msg}`);
    }
  }
  if (bad) {
    console.error(`\nFAILED: ${bad} body-limit violation(s). Every Fastify app needs an explicit bodyLimit <= ${CAP_BYTES} bytes (see header of this script).`);
    process.exit(1);
  }
  console.log(`fastify-bodylimit-guard: OK -- ${apps} Fastify() call(s), all with an explicit bodyLimit <= ${CAP_BYTES} bytes.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
