#!/usr/bin/env node
/**
 * COMP-007 scanner: registered modules with zero test references.
 *
 * Built for gap COMP-007 ("registered modules with zero test references").
 * Run repeatedly as this campaign's modules gain tests, or in CI as a ratchet
 * (see the --max-zero-test flag) the same way scripts/ci/*-guard.mjs baseline
 * against a tracked count elsewhere in this repo.
 *
 * Usage:
 *   node scripts/ci/zero-test-module-scanner.mjs                  # human-readable summary
 *   node scripts/ci/zero-test-module-scanner.mjs --json           # full JSON (for tooling)
 *   node scripts/ci/zero-test-module-scanner.mjs --max-zero-test=30   # exit 1 if count > 30
 *
 * For each services/<svc>/ with a src/app.ts and/or src/worker.ts:
 *   1. Parse app.ts for module ROUTE imports (static `import {..} from "./modules/<m>/f.js"`
 *      AND dynamic `const {..} = await import("./modules/<m>/f.js")`) and worker.ts for
 *      module CONSUMER imports (same two forms), capturing the bound identifier names per
 *      module directory in each file.
 *   2. A module is "registered" if either:
 *      - one of its app.ts bindings appears as an argument to `app.register(` in app.ts, or
 *      - one of its worker.ts bindings is called (`binding(...)`, the
 *        `registerXConsumers(queue)` convention this repo uses) in worker.ts.
 *      (COMP-007's own DoD text is "Tests per module (route + consumer)" -- a module
 *      registered only via worker.ts, like finance-service's revenue-billing, is squarely
 *      in scope and was missed entirely by an app.ts-only first pass.)
 *   3. A registered module "has a test" if ANY of:
 *      a. a *.test.ts file physically lives inside src/modules/<m>/ (colocated)
 *      b. some *.test.ts file anywhere in the service imports a path containing
 *         `modules/<m>/`
 *      c. some *.test.ts file anywhere in the service contains, verbatim, a sufficiently
 *         specific literal route-path prefix (>=3 segments, >=12 chars, stripped at the
 *         first `:` or `${`) that was extracted from one of <m>'s own non-test source files.
 *   4. Modules failing all three are reported as zero-test.
 *
 * Known limitations (honest, not fixed here):
 *   - only app.ts and worker.ts are scanned as registration surfaces; a module registered
 *     from some other entrypoint (queue-service's server.ts, e.g.) would be missed. A
 *     one-time audit found app.ts+worker.ts present for every services/* except
 *     queue-service, which has neither a src/modules/ tree nor the app.ts/worker.ts pair
 *     (it's the queue transport itself, not a domain service) -- so it correctly falls out
 *     of scope, but a future service built on a different pattern would silently be skipped.
 *   - signal (c)'s route-literal matching is a static-text heuristic, not a real HTTP
 *     black-box probe -- it can't tell a route that's merely mentioned in a test's URL
 *     string apart from one that's actually invoked and asserted on.
 *   - COMP-007 tranche 2: signal (c)'s regex (`["'`](\/[a-zA-Z][a-zA-Z0-9_\-\/:]*)["'`]`)
 *     requires the literal to run uninterrupted from the opening quote/backtick to the
 *     closing one. A template literal that interpolates a path param BEFORE the route
 *     ends -- e.g. `` `/v1/tenants/${tenantId}/feature-flags` `` -- has no substring
 *     that satisfies this (the match attempt dies at `$`, which isn't in the allowed
 *     character class, before reaching a closing backtick), so it contributes no
 *     route-literal signal at all. Confirmed concretely: tenant-service's
 *     tenant-extensions module gained a real, thorough, disposable-Postgres-verified
 *     test suite in tranche 2 (11 tests, tests/comp-007-tenant-extensions-smoke.test.ts)
 *     that builds every URL this exact way, and this scanner still reports it
 *     zero-test afterward -- a false positive, not a real gap. Not fixed here
 *     (a template-aware rewrite of signal (c) is a real change to a shared, heavily
 *     relied-on CI gate and deserves its own review, not a drive-by inside a tranche
 *     whose job is adding tests); flagging precisely so whoever picks this up next
 *     doesn't have to rediscover it, and doesn't miscount tenant-extensions as
 *     still-needing-tests.
 *   - COMP-007 tranche 3: a SECOND, DIFFERENT false-positive class in the same
 *     signal (c), unrelated to the template-literal issue above. Source-side
 *     extraction (extractRouteLiterals(), run over the MODULE's own source
 *     files, not the test) cuts each literal at its first `:` or `$` and
 *     strips trailing slashes before the `length >= 12 && segments >= 3`
 *     check -- so a module whose routes are all `/v1/<svc>/<name>` plus
 *     `:id`-suffixed variants (e.g. `/v1/crm/rti`, `/v1/crm/rti/:id/forward`)
 *     has every candidate literal collapse to the SAME short base path after
 *     that cut. `/v1/crm/rti` is exactly 11 characters -- one under the
 *     12-char floor -- so extractRouteLiterals() never emits ANY candidate
 *     for this module from its own source, regardless of how a test is
 *     phrased; there is nothing for signal (c) to search test files for in
 *     the first place. Confirmed concretely: crm-service's rti module gained
 *     a real, thorough, disposable-Postgres-verified test suite in tranche 3
 *     (13 tests, tests/comp-007-rti-smoke.test.ts, covering every route
 *     including the full statutory RTI Act lifecycle) and this scanner still
 *     reports it zero-test -- a false positive, not a real gap. Not fixed
 *     here, same reasoning as tenant-extensions above: retuning the 12-char/
 *     3-segment thresholds (or the cut-point heuristic) is a real change to
 *     this shared CI gate's matching behavior across all 65 services, not
 *     something to retune blindly inside a tranche whose job is adding
 *     tests -- it needs its own pass checking the effect on every other
 *     service's routes, not just this one module.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv.slice(2).find((a) => !a.startsWith("--")) || process.cwd();
const SERVICES_DIR = join(ROOT, "services");

function walk(dir, out = [], opts = {}) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out, opts);
    else if (opts.filter ? opts.filter(e.name) : true) out.push(full);
  }
  return out;
}

function extractImportedModules(appTsContent) {
  // module -> Set(bindingNames)
  const moduleBindings = new Map();

  // Static: import { a, b as c } from "./modules/<mod>/<file>";
  const staticRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']\.\/modules\/([^\/"']+)\/[^"']*["']/g;
  // Dynamic: const { a, b } = await import("./modules/<mod>/<file>.js")
  const dynamicRe = /(?:const|let)\s*\{([^}]+)\}\s*=\s*await\s+import\(\s*["']\.\/modules\/([^\/"']+)\/[^"']*["']\s*\)/g;

  for (const re of [staticRe, dynamicRe]) {
    let m;
    while ((m = re.exec(appTsContent))) {
      const names = m[1].split(",").map((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        return (parts[1] || parts[0]).trim();
      }).filter(Boolean);
      const mod = m[2];
      if (!moduleBindings.has(mod)) moduleBindings.set(mod, new Set());
      names.forEach((n) => moduleBindings.get(mod).add(n));
    }
  }
  return moduleBindings;
}

function isRegistered(appTsContent, bindingNames) {
  for (const name of bindingNames) {
    const re = new RegExp(`app\\.register\\(\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,)]`);
    if (re.test(appTsContent)) return true;
  }
  return false;
}

// worker.ts consumers are registered as bare function calls: `registerXConsumers(queue);`
// (no `app.register(` wrapper). Treat "bound name immediately followed by (" as registered,
// but require the call to NOT be the same line as its own declaration (avoid matching the
// `export function <name>(` definition itself if it were ever re-exported/imported oddly).
function isCalled(fileContent, bindingNames) {
  for (const name of bindingNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<!function\\s)\\b${escaped}\\s*\\(`, "g");
    let m;
    while ((m = re.exec(fileContent))) {
      // skip the import/require line itself
      const lineStart = fileContent.lastIndexOf("\n", m.index) + 1;
      const line = fileContent.slice(lineStart, fileContent.indexOf("\n", m.index));
      if (/^\s*(import|const|let)\b/.test(line) && /await import\(|from\s+["']/.test(line)) continue;
      return true;
    }
  }
  return false;
}

function extractRouteLiterals(fileContent) {
  const out = [];
  // Most routes are prefixed /v1/..., but not all (e.g. identity-service's
  // gov-integrations uses /identity/gov/...) -- match any absolute path, not
  // just /v1/, so this signal isn't blind to non-standard prefixes.
  const re = /["'`](\/[a-zA-Z][a-zA-Z0-9_\-\/:]*)["'`]/g;
  let m;
  while ((m = re.exec(fileContent))) {
    let lit = m[1];
    const cutIdx = Math.min(
      ...[lit.indexOf(":"), lit.indexOf("$")].map((i) => (i === -1 ? Infinity : i)),
    );
    if (cutIdx !== Infinity) lit = lit.slice(0, cutIdx);
    lit = lit.replace(/\/+$/, "");
    const segments = lit.split("/").filter(Boolean);
    if (lit.length >= 12 && segments.length >= 3) out.push(lit);
  }
  return [...new Set(out)];
}

function scanService(svcPath, svcName) {
  const appTsPath = join(svcPath, "src", "app.ts");
  const workerTsPath = join(svcPath, "src", "worker.ts");
  const hasApp = existsSync(appTsPath);
  const hasWorker = existsSync(workerTsPath);
  if (!hasApp && !hasWorker) return null;
  const appTsContent = hasApp ? readFileSync(appTsPath, "utf8") : "";
  const workerTsContent = hasWorker ? readFileSync(workerTsPath, "utf8") : "";

  const modulesDir = join(svcPath, "src", "modules");
  if (!existsSync(modulesDir)) return null;
  const moduleDirNames = readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const appBindings = extractImportedModules(appTsContent);
  const workerBindings = extractImportedModules(workerTsContent);

  const registeredVia = new Map(); // module -> ['route'|'consumer', ...]
  for (const m of moduleDirNames) {
    const via = [];
    const ab = appBindings.get(m);
    if (ab && ab.size > 0 && isRegistered(appTsContent, ab)) via.push("route");
    const wb = workerBindings.get(m);
    if (wb && wb.size > 0 && isCalled(workerTsContent, wb)) via.push("consumer");
    if (via.length > 0) registeredVia.set(m, via);
  }
  const registeredModules = [...registeredVia.keys()];

  // All test files in the service.
  const allFiles = walk(svcPath, [], {});
  const testFiles = allFiles.filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"));
  const testFileContents = testFiles.map((f) => {
    try { return { path: f, content: readFileSync(f, "utf8") }; } catch { return { path: f, content: "" }; }
  });
  const combinedTestText = testFileContents.map((t) => t.content).join("\n");

  const results = [];
  for (const mod of registeredModules) {
    const modDir = join(modulesDir, mod);
    const modFiles = walk(modDir, [], {});
    const modSourceFiles = modFiles.filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && (f.endsWith(".ts") || f.endsWith(".tsx")));
    const modTestFilesColocated = modFiles.filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"));

    let hasTest = false;
    let reason = null;

    if (modTestFilesColocated.length > 0) {
      hasTest = true;
      reason = `colocated:${modTestFilesColocated.map((f) => relative(svcPath, f)).join(",")}`;
    }

    if (!hasTest) {
      // Check EVERY line mentioning modules/<mod>/, not just the first (a file
      // can mention it first in a doc-comment before the real import line).
      const modPathFrag = `modules/${mod}/`;
      const hit = testFileContents.find((t) =>
        t.content.split("\n").some((l) => l.includes(modPathFrag) && /\b(import|require)\b/.test(l)),
      );
      if (hit) { hasTest = true; reason = `imports-module:${relative(svcPath, hit.path)}`; }
    }

    let sampleRoutes = [];
    if (!hasTest) {
      const literals = new Set();
      for (const f of modSourceFiles) {
        try {
          const c = readFileSync(f, "utf8");
          extractRouteLiterals(c).forEach((l) => literals.add(l));
        } catch {}
      }
      sampleRoutes = [...literals].slice(0, 6);
      for (const lit of literals) {
        if (combinedTestText.includes(lit)) { hasTest = true; reason = `path-literal:${lit}`; break; }
      }
    }

    if (!hasTest) {
      // rough LOC of the module (excluding tests) as a proxy for "real logic" size
      let loc = 0;
      for (const f of modSourceFiles) {
        try { loc += readFileSync(f, "utf8").split("\n").length; } catch {}
      }
      results.push({
        module: mod,
        via: registeredVia.get(mod),
        files: modSourceFiles.map((f) => relative(svcPath, f)),
        loc,
        sampleRoutes,
      });
    }
  }

  return {
    service: svcName,
    registeredCount: registeredModules.length,
    zeroTestCount: results.length,
    zeroTest: results,
  };
}

function main() {
  const args = process.argv.slice(2);
  const wantsJson = args.includes("--json");
  const maxArg = args.find((a) => a.startsWith("--max-zero-test="));
  const maxZeroTest = maxArg ? Number(maxArg.split("=")[1]) : null;

  const svcDirs = readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const services = [];
  for (const svc of svcDirs) {
    const svcPath = join(SERVICES_DIR, svc);
    const r = scanService(svcPath, svc);
    if (r) services.push(r);
  }

  const totals = {
    servicesScanned: services.length,
    totalRegisteredModules: services.reduce((a, s) => a + s.registeredCount, 0),
    totalZeroTestModules: services.reduce((a, s) => a + s.zeroTestCount, 0),
  };

  const result = { generatedAt: new Date().toISOString(), totals, services };

  if (wantsJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`COMP-007 zero-test-module scan -- ${result.generatedAt}`);
    console.log(`  services scanned:        ${totals.servicesScanned}`);
    console.log(`  registered modules:      ${totals.totalRegisteredModules}`);
    console.log(`  zero-test modules:       ${totals.totalZeroTestModules}`);
    console.log("");
    for (const s of services) {
      if (s.zeroTestCount === 0) continue;
      console.log(`${s.service} (${s.zeroTestCount}/${s.registeredCount} registered modules with no test):`);
      for (const m of s.zeroTest) {
        console.log(`  - ${m.module} [${m.via.join("+")}] (${m.loc} LOC across ${m.files.length} file(s))`);
      }
    }
    console.log("\nRun with --json for machine-readable output.");
  }

  if (maxZeroTest !== null && totals.totalZeroTestModules > maxZeroTest) {
    console.error(`\nFAIL: ${totals.totalZeroTestModules} zero-test modules exceeds --max-zero-test=${maxZeroTest}`);
    process.exit(1);
  }
}

main();
