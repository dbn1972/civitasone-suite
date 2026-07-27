#!/usr/bin/env node
/**
 * package-exports-guard.mjs
 *
 * Fails if a workspace package's `main` / `types` / `exports` map points at a
 * path that does not exist on disk.
 *
 * THE DEFECT THIS CATCHES
 * -----------------------
 * `@civitasone/render` and `@civitasone/storage` declared
 * `"exports": { ".": "./src/index.js" }` while shipping compiled output in
 * `dist/`. `src/` holds TypeScript, so `src/index.js` never exists at runtime.
 * Node throws ERR_MODULE_NOT_FOUND at the first import, so every service that
 * imports them dies during `await buildApp()` — before opening any socket.
 *
 * Observed impact: payroll (:3013), admin (:3022) and knowledge (:3028) sat in
 * `epoll_wait` with ZERO TCP sockets while pm2 reported them "online" with empty
 * error logs. 3 services down, invisible to the process manager, for ~20 hours.
 *
 * Typecheck cannot catch this: `tsc` resolves via `paths`/source, not the
 * published `exports` map. Only a runtime import or this static check sees it.
 *
 * Usage: node scripts/ci/package-exports-guard.mjs
 * Exit:  0 clean, 1 on any unresolvable entry point.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** Collect every declared entry-point path from a package.json. */
function entryPoints(pkg) {
  const out = [];
  for (const field of ["main", "module", "types"]) {
    if (typeof pkg[field] === "string") out.push([field, pkg[field]]);
  }
  const walk = (node, path) => {
    if (typeof node === "string") {
      out.push([`exports${path}`, node]);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}["${k}"]`);
    }
  };
  if (pkg.exports !== undefined) walk(pkg.exports, "");
  return out;
}

const violations = [];
let scanned = 0;

if (existsSync(PACKAGES_DIR) === false) {
  console.error(`packages/ not found at ${PACKAGES_DIR}`);
  process.exit(1);
}

for (const dir of readdirSync(PACKAGES_DIR)) {
  const pkgPath = join(PACKAGES_DIR, dir, "package.json");
  if (existsSync(pkgPath) === false) continue;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (e) {
    violations.push({ pkg: dir, field: "package.json", target: "-", reason: `unparseable: ${e.message}` });
    continue;
  }
  scanned += 1;

  for (const [field, target] of entryPoints(pkg)) {
    // Only relative file targets are checkable; skip conditions like "node".
    if (typeof target !== "string" || target.startsWith(".") === false) continue;
    if (existsSync(join(PACKAGES_DIR, dir, target))) continue;

    // Distinguish the common root cause for a clearer message.
    const looksLikeSrc = target.includes("/src/");
    const distAlt = target.replace("/src/", "/dist/");
    const distExists = looksLikeSrc && existsSync(join(PACKAGES_DIR, dir, distAlt));

    violations.push({
      pkg: pkg.name ?? dir,
      field,
      target,
      reason: distExists
        ? `missing, but compiled output IS present at ${distAlt} — point the map at dist/`
        : "missing (package may be unbuilt)",
    });
  }
}

console.log("──────────────────────────────────────────────────────────────");
console.log("  Package Exports Guard — entry points must resolve on disk");
console.log("──────────────────────────────────────────────────────────────");
console.log(`  packages scanned : ${scanned}`);
console.log("");

if (violations.length === 0) {
  console.log("  CLEAN — every declared entry point resolves.");
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(0);
}

console.log(`  ${violations.length} unresolvable entry point(s):`);
console.log("");
for (const v of violations) {
  console.log(`  [${v.pkg}] ${v.field} -> ${v.target}`);
  console.log(`      ${v.reason}`);
}
console.log("");
console.log("  A package whose entry point does not exist throws");
console.log("  ERR_MODULE_NOT_FOUND at the first import. Any service importing");
console.log("  it dies during startup BEFORE binding a port — which a process");
console.log('  manager reports as "online" with an empty error log.');
console.log("──────────────────────────────────────────────────────────────");
process.exit(1);
