#!/usr/bin/env node
// -----------------------------------------------------------------------------
// fastify-unused-features-guard.mjs -- keep the Fastify features we rely on being
// "not affected" by five Fastify CVEs from creeping into the code base.
//
// WHY: .trivyignore carries owner-approved, expiring ignores for fastify
// CVE-2026-25223, CVE-2026-76169, CVE-2026-84428, CVE-2026-84469 and CVE-2026-84504.
// The security assessment found them NOT APPLICABLE because no service uses Fastify
// route schemas, `$async` validation or a custom not-found handler. That conclusion
// is only true while the statement stays true, so this guard fails the build the
// moment any of those features is introduced. Remove it (and the ignores) with the
// Fastify 5 upgrade.
//
// RULES (every src dir under services/** and packages/**, tests excluded):
//   1. a Fastify route-options `schema:` key -- i.e. an object literal passed directly
//      to .get/.post/.put/.patch/.delete/.head/.options/.all/.route(...) containing
//      `schema:` (or shorthand `schema`). Zod objects that merely happen to be NAMED
//      `schema` (const schema = z.object(...)) inside handlers are not matched.
//   2. `$async`
//   3. `attachValidation`
//   4. `setValidatorCompiler`
//   5. `addSchema(`
//   6. `setNotFoundHandler`
//
// Usage: node scripts/ci/fastify-unused-features-guard.mjs  (repo root; exit 1 on violation)
// -----------------------------------------------------------------------------
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "tests", "__tests__", "coverage"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && /\.(ts|mts|js|mjs)$/.test(ent.name) && !/\.(test|spec)\./.test(ent.name) && !ent.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const IDENT_STRING = /^[A-Za-z_$][\w$]*$/;

/**
 * Blank out comments and string contents (offsets preserved) so braces/parens inside
 * them are ignored. A string that is a bare identifier ("schema", '$async') keeps its
 * content so quoted object keys are still recognisable.
 */
export function mask(src) {
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
      let j = i + 1;
      while (j < src.length && src[j] !== q) j += src[j] === "\\" ? 2 : 1;
      const body = src.slice(i + 1, j);
      out += q;
      if (q !== "`" && IDENT_STRING.test(body)) out += body;
      else out += body.replace(/[^\n]/g, " ");
      out += q;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const OPEN = new Set(["(", "{", "["]);
const CLOSE = new Set([")", "}", "]"]);

/** Index of the bracket matching the one at `open` (masked text), or text.length. */
function matching(m, open) {
  let depth = 0;
  for (let i = open; i < m.length; i++) {
    if (OPEN.has(m[i])) depth++;
    else if (CLOSE.has(m[i]) && --depth === 0) return i;
  }
  return m.length;
}

/** Previous non-whitespace char before index i. */
function prevChar(m, i) {
  for (let k = i - 1; k >= 0; k--) if (!/\s/.test(m[k])) return m[k];
  return "";
}

const SCHEMA_KEY = /["'`]?schema["'`]?\s*[:,}]/y;
const ROUTE_CALL = /(?:\.\s*(?:get|post|put|patch|delete|head|options|all|route)|(?<![\w$.])route)\s*\(/g;

export function checkSource(src) {
  const m = mask(src);
  const lineOf = (idx) => m.slice(0, idx).split("\n").length;
  const out = [];

  // 1. route-options `schema` key
  for (const call of m.matchAll(ROUTE_CALL)) {
    const open = call.index + call[0].length - 1;
    const close = matching(m, open);
    let depth = 0; // nesting inside the call's own argument list
    for (let i = open + 1; i < close; i++) {
      const ch = m[i];
      if (ch === "{" && depth === 0 && /[(,]/.test(prevChar(m, i))) {
        // direct object-literal argument: scan its top-level keys
        const end = matching(m, i);
        let d = 0;
        for (let k = i + 1; k < end; k++) {
          const c2 = m[k];
          if (OPEN.has(c2)) d++;
          else if (CLOSE.has(c2)) d--;
          else if (d === 0 && /[{,]/.test(prevChar(m, k))) {
            SCHEMA_KEY.lastIndex = k;
            if (SCHEMA_KEY.test(m)) {
              out.push({ line: lineOf(k), rule: "route-schema", msg: "Fastify route `schema:` option is not allowed (see header: CVE not-affected evidence)" });
            }
          }
        }
        i = end;
        continue;
      }
      if (OPEN.has(ch)) depth++;
      else if (CLOSE.has(ch)) depth--;
    }
  }

  const simple = [
    [/\$async\b/g, "async-validation", "`$async` schema validation is not allowed"],
    [/\battachValidation\b/g, "attach-validation", "`attachValidation` is not allowed"],
    [/\bsetValidatorCompiler\b/g, "set-validator-compiler", "`setValidatorCompiler` is not allowed"],
    [/\baddSchema\s*\(/g, "add-schema", "`addSchema(` is not allowed"],
    [/\bsetNotFoundHandler\b/g, "set-not-found-handler", "`setNotFoundHandler` is not allowed"],
  ];
  for (const [re, rule, msg] of simple) {
    for (const mm of m.matchAll(re)) out.push({ line: lineOf(mm.index), rule, msg });
  }
  return out;
}

/** Every `src` dir at any depth under `base` (e.g. services/adapters/india-post/apt-adapter/src), skipping node_modules/dist. */
export function findSrcDirs(base, out = []) {
  if (!existsSync(base)) return out;
  for (const ent of readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === "node_modules" || ent.name === "dist" || ent.name.startsWith(".")) continue;
    const p = join(base, ent.name);
    if (ent.name === "src") out.push(p);
    else findSrcDirs(p, out);
  }
  return out;
}

export function collectFiles(root) {
  const files = [];
  for (const group of ["services", "packages"]) {
    for (const dir of findSrcDirs(join(root, group))) walk(dir, files);
  }
  return files;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const files = collectFiles(root);
  let bad = 0;
  for (const f of files) {
    for (const v of checkSource(readFileSync(f, "utf8"))) {
      bad++;
      console.error(`${relative(root, f)}:${v.line}  [${v.rule}] ${v.msg}`);
    }
  }
  if (bad) {
    console.error(`\nFAILED: ${bad} use(s) of Fastify features that the .trivyignore "not affected" assessment depends on avoiding.`);
    console.error("Either drop the feature, or re-assess fastify CVE-2026-25223/76169/84428/84469/84504 and update .trivyignore + this guard.");
    process.exit(1);
  }
  console.log(`fastify-unused-features-guard: OK -- ${files.length} source file(s) scanned; no route schema/$async/attachValidation/setValidatorCompiler/addSchema/setNotFoundHandler.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
