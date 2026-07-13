#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// adopt-tenant-router.mjs — TenantRouter-adoption codemod (Req 1.1, task 4.3)
//
// Mechanically rewrites a single service's `services/<svc>-service/src/shared/db.ts`
// from the legacy hand-rolled `createSqlClient()` shape to the `createTenantDb()`
// target shape documented in the design (`packages/db/src/create-tenant-db.ts`):
//
//   import { createTenantDb } from "@civitasone/db";
//   import { schema as xModule } from "../modules/x/schema.js";
//   // ...(every other per-module schema import, preserved verbatim)
//   import { outboxSchema } from "./outbox.js";
//
//   const SCHEMA = { ...xModule, ...outboxSchema };
//   const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });
//   export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
//
// The codemod NEVER touches the per-module schema-import lines themselves — it
// slices them out of the original source byte-for-byte (including whatever
// manual column alignment a service's author used) and re-emits them unchanged.
// Everything else (the createSqlClient/drizzle/GUC-wrapping boilerplate) is
// discarded and replaced by the fixed template above, since `createTenantDb()`
// performs the exact same `wrapWithTenantGuc` wiring internally (see
// packages/db/src/create-tenant-db.ts) — this is a behavior-preserving rewrite,
// not a functional change.
//
// SAFETY:
//   - Idempotent: a file that already goes through `createTenantDb(` or the
//     hand-rolled `TenantRouter` pattern (estab-service today) is reported as
//     already-compliant and left untouched, whether or not --write is passed.
//   - Conservative: if the file exports anything beyond the standard
//     {sqlClient, db, type Db, sqlClientFor, dbFor, tierOf, dbForRead} surface
//     (e.g. hrms-service's extra `sqlPool` adapter), or the codemod cannot find
//     a `drizzle(client, { schema: ... })` call it understands, it ABORTS
//     without writing anything and reports exactly what needs manual migration.
//   - Dry-run by default: prints the generated file to stdout without touching
//     disk unless `--write` is passed. This task (4.3) implements the codemod
//     only — fleet-wide application across all 32 services is a separate task
//     (4.4) that runs this script per service and verifies compilation.
//
// Usage:
//   node scripts/codemod/adopt-tenant-router.mjs <service>            (dry run — prints result)
//   node scripts/codemod/adopt-tenant-router.mjs <service> --write    (persists the rewrite)
//
// <service> may be given as "estab" or "estab-service" — both resolve to
// services/estab-service/src/shared/db.ts.
//
// Exit codes: 0 = compliant-already / rewritten (or dry-run preview) successfully.
//             1 = file not found, parse failure, or unsupported construct found.
//
// Pure Node ESM, no external dependencies — mirrors scripts/ci/tenant-router-guard.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/codemod/adopt-tenant-router.mjs  ->  repo root is two levels up.
const REPO_ROOT = join(__dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const positional = [];
  let write = false;
  for (const arg of argv) {
    if (arg === "--write") write = true;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else positional.push(arg);
  }
  return { service: positional[0], write };
}

function printUsage() {
  console.log("Usage: node scripts/codemod/adopt-tenant-router.mjs <service> [--write]");
  console.log('  <service> e.g. "estab" or "estab-service"');
  console.log("  --write   persist the rewrite (default: dry-run, prints to stdout)");
}

function resolveDbFile(serviceArg) {
  const svcDir = serviceArg.endsWith("-service") ? serviceArg : `${serviceArg}-service`;
  return join(SERVICES_DIR, svcDir, "src", "shared", "db.ts");
}

// ── 1. Idempotency check — mirrors scripts/ci/tenant-router-guard.mjs ───────
const CREATE_SQL_CLIENT_CALL_RE = /\bcreateSqlClient\s*\(/;
const CREATE_TENANT_DB_CALL_RE = /\bcreateTenantDb\s*\(/;
const NEW_TENANT_ROUTER_RE = /\bnew\s+TenantRouter\s*\(/;
const IMPORT_NAMED_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

function isAlreadyCompliant(source) {
  const hasCreateTenantDbCall = CREATE_TENANT_DB_CALL_RE.test(source);
  if (hasCreateTenantDbCall) return true;

  let importsTenantRouterFromDb = false;
  IMPORT_NAMED_RE.lastIndex = 0;
  let im;
  while ((im = IMPORT_NAMED_RE.exec(source)) !== null) {
    const [, names, spec] = im;
    if (spec === "@civitasone/db") {
      const imported = names.split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      if (imported.includes("TenantRouter")) importsTenantRouterFromDb = true;
    }
  }
  return importsTenantRouterFromDb && NEW_TENANT_ROUTER_RE.test(source);
}

// ── 2. Balanced-brace extraction (best-effort; no string/comment awareness —
//    sufficient for the narrow drizzle()/schema-object shapes this targets) ──
function extractBalancedBraces(source, openIndex) {
  if (source[openIndex] !== "{") return null;
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return { inner: source.slice(openIndex + 1, i), endIndex: i };
    }
  }
  return null; // unbalanced — caller treats as a parse failure
}

// ── 3. Per-module schema-import block — preserved verbatim ─────────────────
// A "module schema import" is any import whose specifier reaches into
// `../modules/**` (this service's own module schemas) or is the sibling
// `./outbox.js` outbox-schema import. Every other import (drizzle, postgres,
// @civitasone/db, drizzle-orm) is legacy boilerplate the codemod replaces.
function isPreservedImportLine(line) {
  const m = /^\s*import\s+.*\bfrom\s+['"]([^'"]+)['"]\s*;?\s*$/.exec(line);
  if (!m) return false;
  const spec = m[1];
  return spec.includes("/modules/") || spec === "./outbox.js";
}

function extractPreservedImportBlock(source) {
  const lines = source.split("\n");
  const preserved = [];
  for (const line of lines) {
    if (isPreservedImportLine(line)) preserved.push(line);
  }
  return preserved;
}

// ── 4. Locate the drizzle(client, { schema: ... }) call and its spreads ────
function findSchemaSpreads(source) {
  const callMatch = /\bdrizzle\s*\(/.exec(source);
  if (!callMatch) return { error: "no drizzle(...) call found" };

  const afterCall = callMatch.index + callMatch[0].length;
  const braceIdx = source.indexOf("{", afterCall);
  if (braceIdx === -1) return { error: "drizzle(...) call has no options object" };

  const opts = extractBalancedBraces(source, braceIdx);
  if (!opts) return { error: "unbalanced braces in drizzle(...) options object" };

  const schemaKeyMatch = /schema\s*:\s*/.exec(opts.inner);
  if (!schemaKeyMatch) return { error: "no `schema:` key found in drizzle(...) options" };

  const afterSchemaKey = schemaKeyMatch.index + schemaKeyMatch[0].length;
  const rest = opts.inner.slice(afterSchemaKey);
  const trimmed = rest.replace(/^\s+/, "");
  const leadingWs = rest.length - trimmed.length;

  let schemaObjectInner;
  if (trimmed[0] === "{") {
    const inline = extractBalancedBraces(opts.inner, afterSchemaKey + leadingWs);
    if (!inline) return { error: "unbalanced braces in inline schema object literal" };
    schemaObjectInner = inline.inner;
  } else {
    // schema: SOME_IDENTIFIER — resolve the const it points to, in the full source.
    const identMatch = /^([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (!identMatch) return { error: "could not read the `schema:` value" };
    const ident = identMatch[1];
    const constRe = new RegExp(`\\b(?:const|let)\\s+${ident}\\s*=\\s*`, "m");
    const constMatch = constRe.exec(source);
    if (!constMatch) return { error: `schema identifier "${ident}" has no matching const/let declaration` };
    const declBraceIdx = source.indexOf("{", constMatch.index + constMatch[0].length);
    if (declBraceIdx === -1) return { error: `"${ident}" is not assigned an object literal` };
    const declObj = extractBalancedBraces(source, declBraceIdx);
    if (!declObj) return { error: `unbalanced braces in "${ident}"'s object literal` };
    schemaObjectInner = declObj.inner;
  }

  const spreads = [];
  const spreadRe = /\.\.\.\s*([A-Za-z_$][\w$]*)/g;
  let sm;
  while ((sm = spreadRe.exec(schemaObjectInner)) !== null) spreads.push(sm[1]);

  if (spreads.length === 0) return { error: "no `...module` spreads found in the schema object" };
  return { spreads };
}

// ── 5. Exported-surface check — abort on anything the target shape can't
//    represent (e.g. hrms-service's extra `sqlPool` adapter export) ─────────
const STANDARD_EXPORT_NAMES = new Set(["sqlClient", "db", "Db", "sqlClientFor", "dbFor", "tierOf", "dbForRead"]);
const EXPORT_DECL_RE = /^export\s+(?:const|function|class|type)\s+([A-Za-z_$][\w$]*)/gm;

function findNonStandardExports(source) {
  const extra = [];
  EXPORT_DECL_RE.lastIndex = 0;
  let m;
  while ((m = EXPORT_DECL_RE.exec(source)) !== null) {
    if (!STANDARD_EXPORT_NAMES.has(m[1])) extra.push(m[1]);
  }
  return extra;
}

// ── 6. Build the target-shape file content ──────────────────────────────────
function buildTargetContent(serviceLabel, preservedImports, spreads) {
  const schemaLines = spreads.map((name) => `  ...${name},`).join("\n");
  return `/**
 * ${serviceLabel} DB connection — TenantRouter adoption (Req 1.1).
 * @generated by scripts/codemod/adopt-tenant-router.mjs — do not edit manually.
 * Reviewed for correctness (schema wiring), not style, per this service's PR.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 */
import { createTenantDb } from "@civitasone/db";
${preservedImports.join("\n")}

const SCHEMA = {
${schemaLines}
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
`;
}

// ── 7. Run ────────────────────────────────────────────────────────────────────
function main() {
  const { service, write } = parseArgs(process.argv.slice(2));
  if (!service) {
    printUsage();
    process.exit(1);
  }

  const dbFile = resolveDbFile(service);
  if (!existsSync(dbFile)) {
    console.error(`adopt-tenant-router: file not found: ${relative(REPO_ROOT, dbFile).split(sep).join("/")}`);
    process.exit(1);
  }

  const source = readFileSync(dbFile, "utf8");
  const relPath = relative(REPO_ROOT, dbFile).split(sep).join("/");

  if (isAlreadyCompliant(source)) {
    console.log(`✅ ${relPath} — already compliant (createTenantDb()/TenantRouter in use). Nothing to do.`);
    process.exit(0);
  }

  const nonStandardExports = findNonStandardExports(source);
  if (nonStandardExports.length > 0) {
    console.error(`❌ ${relPath} — cannot auto-migrate: exports beyond the standard TenantRouter surface found:`);
    for (const name of nonStandardExports) console.error(`   - export ${name}`);
    console.error("   This service needs manual migration; see scripts/codemod/adopt-tenant-router.mjs header.");
    process.exit(1);
  }

  const schemaResult = findSchemaSpreads(source);
  if (schemaResult.error) {
    console.error(`❌ ${relPath} — cannot auto-migrate: ${schemaResult.error}.`);
    console.error("   This service needs manual migration; see scripts/codemod/adopt-tenant-router.mjs header.");
    process.exit(1);
  }

  const preservedImports = extractPreservedImportBlock(source);
  if (preservedImports.length === 0) {
    console.error(`❌ ${relPath} — cannot auto-migrate: no per-module schema imports (../modules/**) found.`);
    process.exit(1);
  }

  const serviceLabel = dbFile.split(sep).includes("services")
    ? dbFile.split(sep)[dbFile.split(sep).indexOf("services") + 1]
    : service;
  const content = buildTargetContent(serviceLabel, preservedImports, schemaResult.spreads);

  if (write) {
    writeFileSync(dbFile, content);
    console.log(`✅ ${relPath} — rewritten to the createTenantDb() target shape (${schemaResult.spreads.length} schema modules preserved).`);
  } else {
    console.log(`── ${relPath} — dry run (pass --write to persist) ──────────────────────────`);
    console.log(content);
    console.log(`── ${schemaResult.spreads.length} schema modules preserved, ${preservedImports.length} import lines kept verbatim ──`);
  }
}

main();
