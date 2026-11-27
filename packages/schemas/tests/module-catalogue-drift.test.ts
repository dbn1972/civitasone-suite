/**
 * Module catalogue guards (M1/M4).
 *
 *  1. The catalogue is internally sound (known deps, no hard cycle, every service dir is owned).
 *  2. DRIFT: if service code gains a cross-module dependency (a topic owned by another module's service in a
 *     topics.ts, or a <X>_SERVICE_URL call), the catalogue must declare it (hard or soft) between the modules
 *     that own the two services. Otherwise this test fails and names the missing edge.
 *  3. The gateway route map and the catalogue agree in both directions.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOGUE_BY_ID, MODULE_CATALOGUE } from "../src/module-catalogue.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVICES_DIR = join(ROOT, "services");

/** Service dirs that deliberately have no catalogue module (platform plumbing or not yet sold as a module). */
const UNCATALOGUED_SERVICES = new Set([
  "adapters", "admin-service", "ai-agent-service", "catalogue-service", "cdp-service", "document-service",
  "gateway-service", "install-service", "journey-service", "location-service", "loyalty-service", "ml-service",
  "notification-service", "plugin-service", "policy-service", "queue-service", "recommendation-service", "theme-service",
]);

const serviceDirs = readdirSync(SERVICES_DIR).filter((d) => statSync(join(SERVICES_DIR, d)).isDirectory() && existsSync(join(SERVICES_DIR, d, "src")));

const owners = new Map<string, string[]>(); // service -> module ids
for (const m of MODULE_CATALOGUE) for (const s of m.services) owners.set(s, [...(owners.get(s) ?? []), m.id]);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** service -> Map<targetService, evidence> */
function scanEdges(): Map<string, Map<string, string>> {
  const edges = new Map<string, Map<string, string>>();
  const add = (from: string, to: string, why: string): void => {
    if (from === to) return;
    const m = edges.get(from) ?? new Map<string, string>();
    if (!m.has(to)) m.set(to, why);
    edges.set(from, m);
  };
  for (const svc of serviceDirs) {
    for (const file of walk(join(SERVICES_DIR, svc, "src"))) {
      const rel = file.slice(ROOT.length + 1);
      const src = stripComments(readFileSync(file, "utf8"));
      if (/(^|\/)topics\.ts$/.test(file)) {
        for (const m of src.matchAll(/["'`]([a-z][a-z0-9_]*)\.[a-z0-9_.]+["'`]/g)) {
          const target = `${m[1]}-service`;
          if (serviceDirs.includes(target)) add(svc, target, `${rel}: topic ${m[0]}`);
        }
      }
      for (const m of src.matchAll(/\b([A-Z][A-Z0-9]*)_SERVICE_URL\b/g)) {
        const target = `${m[1]!.toLowerCase()}-service`;
        if (serviceDirs.includes(target)) add(svc, target, `${rel}: ${m[0]}`);
      }
    }
  }
  return edges;
}

describe("module catalogue integrity", () => {
  it("has unique ids and only known dependencies", () => {
    const ids = MODULE_CATALOGUE.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODULE_CATALOGUE) {
      for (const d of [...m.hardDeps, ...m.softDeps]) expect(CATALOGUE_BY_ID.has(d), `${m.id} -> ${d}`).toBe(true);
      expect(m.hardDeps.filter((d) => m.softDeps.includes(d)), `${m.id} lists a dep as both hard and soft`).toEqual([]);
    }
  });

  it("has no hard-dependency cycle", () => {
    const state = new Map<string, number>();
    const visit = (id: string, path: string[]): void => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw new Error(`hard cycle: ${[...path, id].join(" -> ")}`);
      state.set(id, 1);
      for (const d of CATALOGUE_BY_ID.get(id)!.hardDeps) visit(d, [...path, id]);
      state.set(id, 2);
    };
    for (const m of MODULE_CATALOGUE) visit(m.id, []);
  });

  it("every service directory is owned by a module or explicitly listed as uncatalogued", () => {
    const unowned = serviceDirs.filter((s) => !owners.has(s) && !UNCATALOGUED_SERVICES.has(s));
    expect(unowned, "add the service to a catalogue module's `services`, or to UNCATALOGUED_SERVICES with a reason").toEqual([]);
    for (const s of owners.keys()) expect(existsSync(join(SERVICES_DIR, s, "src")), `catalogue names missing service ${s}`).toBe(true);
  });

  it("core modules never depend on a non-core module", () => {
    for (const m of MODULE_CATALOGUE.filter((x) => x.isCore)) {
      for (const d of m.hardDeps) expect(CATALOGUE_BY_ID.get(d)!.isCore, `${m.id} -> ${d}`).toBe(true);
    }
  });
});

describe("dependency drift: code vs catalogue", () => {
  it("every cross-module dependency found in service code is declared in the catalogue", () => {
    const missing: string[] = [];
    for (const [from, targets] of scanEdges()) {
      const fromMods = (owners.get(from) ?? []).filter((id) => !CATALOGUE_BY_ID.get(id)!.isCore);
      if (fromMods.length === 0) continue;
      for (const [to, why] of targets) {
        const toMods = (owners.get(to) ?? []).filter((id) => !CATALOGUE_BY_ID.get(id)!.isCore);
        if (toMods.length === 0) continue;
        const declared = fromMods.some((m) => {
          const def = CATALOGUE_BY_ID.get(m)!;
          return toMods.some((p) => p === m || def.hardDeps.includes(p) || def.softDeps.includes(p));
        });
        if (!declared) missing.push(`${from} [${fromMods.join(",")}] -> ${to} [${toMods.join(",")}]  (${why})`);
      }
    }
    expect(missing, "declare each as hardDeps or softDeps in packages/schemas/src/module-catalogue.ts (hard only if it cannot work without it)").toEqual([]);
  });
});

describe("gateway route map vs catalogue", () => {
  const guard = readFileSync(join(SERVICES_DIR, "gateway-service/src/module-guard.ts"), "utf8");
  const routeMap = guard.match(/ROUTE_TO_MODULE: Record<string, string> = \{([\s\S]*?)\n\};/)![1]!;
  const routedKeys = new Set([...routeMap.matchAll(/:\s*"([a-z_-]+)"/g)].map((m) => m[1]!));
  const hrmsSub = readFileSync(join(SERVICES_DIR, "gateway-service/src/hrms-subroute-map.ts"), "utf8");
  const hrmsKeys = new Set([...hrmsSub.matchAll(/"((?:hrms-[a-z-]+)|workforce_core)"/g)].map((m) => m[1]!));
  const catalogueKeys = new Set(MODULE_CATALOGUE.flatMap((m) => m.gatewayKeys));
  // `hrms` is the legacy blanket key (admin_module_configs only, replaced by hrms-* sub-keys under composition);
  // `documents` is a platform route that is never module-gated.
  const LEGACY_OR_PLATFORM = new Set(["hrms", "documents"]);

  it("every module key the gateway routes is unlockable through the catalogue", () => {
    const unreachable = [...routedKeys].filter((k) => !catalogueKeys.has(k) && !LEGACY_OR_PLATFORM.has(k));
    expect(unreachable, "gateway routes a module no catalogue entry projects: under enforce every tenant would get 403").toEqual([]);
  });

  it("every gateway key the catalogue projects is one the gateway actually knows", () => {
    // hrms-<x> keys are derived from route prefixes inside hrms-subroute-map.ts (not listed as literals).
    const hrmsKnown = (k: string): boolean => k.startsWith("hrms-") && (hrmsSub.includes(k.slice(5)) || hrmsSub.includes(k.slice(5).replace(/-/g, "_")));
    const unknown = [...catalogueKeys].filter((k) => !routedKeys.has(k) && !hrmsKeys.has(k) && !hrmsKnown(k));
    expect(unknown).toEqual([]);
  });

  it("every HRMS sub-route key is projected by a catalogue module", () => {
    expect([...hrmsKeys].filter((k) => !catalogueKeys.has(k))).toEqual([]);
  });
});


describe("web ModuleGate keys vs gateway enforcement (UI/gateway parity)", () => {
  // Every <ModuleGate moduleKey=\"X\"> in apps/web must correspond to something the
  // GATEWAY enforces for that module API: a catalogue-backed gateway key
  // (ROUTE_TO_MODULE / composition projection), a platform route (never gated), or
  // an explicitly documented UI-only surface. Without parity the UI can hide a
  // module while its API stays reachable regardless of subscription (fail-open).
  const guardSrc = stripComments(readFileSync(join(SERVICES_DIR, "gateway-service/src/module-guard.ts"), "utf8"));
  const matchSrc = stripComments(readFileSync(join(ROOT, "apps/web/src/lib/moduleMatch.ts"), "utf8"));
  const quoted = (s: string): string[] => [...s.matchAll(/"([a-z0-9_-]+)"/g)].map((m) => m[1]!);

  // Gateway vocabulary.
  const routeMapBlock = guardSrc.match(/ROUTE_TO_MODULE: Record<string, string> = \{([\s\S]*?)\n\};/)![1]!;
  const routeEntries = new Map<string, string>();
  for (const m of routeMapBlock.matchAll(/"?([a-z0-9-]+)"?:\s*"([a-z0-9_-]+)"/g)) routeEntries.set(m[1]!, m[2]!);
  const routedKeys = new Set(routeEntries.values());
  const gatewayPlatform = new Set(quoted(guardSrc.match(/PLATFORM_ROUTES = new Set\(\[([\s\S]*?)\]\);/)![1]!));
  const catalogueKeys = new Set(MODULE_CATALOGUE.flatMap((m) => m.gatewayKeys));
  // Keys a composed tenant allow-list (hence the web gate) can actually match.
  const enforceableKeys = new Set([...catalogueKeys, ...routedKeys]);

  // Web vocabulary (parsed from source, matching how this file reads the guard).
  const webPlatform = new Set(quoted(matchSrc.match(/PLATFORM_MODULE_KEYS = new Set\(\[([\s\S]*?)\]\)/)![1]!));
  const aliasBlock = matchSrc.match(/MODULE_ALIASES:[^=]*=\s*\{([\s\S]*?)\n\};/)![1]!;
  const webAliases: Record<string, string[]> = {};
  for (const m of aliasBlock.matchAll(/([a-z0-9_-]+):\s*\[([^\]]*)\]/g)) webAliases[m[1]!] = quoted(m[2]!);
  // HR-area switch keys (hrms/payroll/recruitment + the \"hr\" spelling): logical
  // switches, not catalogue keys. The HRMS surface is gated path-aware
  // (services/gateway-service/src/hrms-subroute-map.ts); a switch is enforced iff
  // its catalogue sub-keys exist (asserted below).
  const hrSwitchKeys = new Set([
    matchSrc.match(/HR_SWITCH = "([a-z-]+)"/)![1]!,
    matchSrc.match(/PAYROLL_SWITCH = "([a-z-]+)"/)![1]!,
    matchSrc.match(/RECRUITMENT_SWITCH = "([a-z-]+)"/)![1]!,
    "hr",
  ]);

  // Web keys a module layout gates on for which NO catalogue entitlement exists to
  // gate the API against: the service is uncatalogued platform plumbing or a core
  // engine. Gating these at the gateway would 403 every tenant. Each needs a reason.
  const WEB_UI_ONLY_MODULE_KEYS: Record<string, string> = {
    cdp: "cdp-service is uncatalogued platform plumbing (not sold as a module); no catalogue gatewayKey. API intentionally fail-open. Add a MODULE_CATALOGUE entry + gateway gate to sell it.",
    loyalty: "loyalty-service - uncatalogued, not sold as a module (see cdp).",
    recommendation: "recommendation-service - uncatalogued, not sold as a module (see cdp).",
    "ai-agent": "ai-agent-service - uncatalogued platform assistant, not a sellable module.",
    catalogue: "catalogue-service - uncatalogued platform plumbing, not a sellable module.",
    journey: "journey-service - uncatalogued, not sold as a module (see cdp).",
    metadata: "config/metadata engine (catalogue id `config`, isCore, gatewayKeys=[]) - a core platform surface, never module-gated.",
    themes: "theme-service - uncatalogued platform plumbing; gateway route `theme` is a PLATFORM_ROUTE. Theming is platform-wide.",
    designer: "no backing service (web-only studio UI); nothing to gate at the gateway.",
  };

  function scanWebModuleKeys(): Set<string> {
    const out = new Set<string>();
    const stack = [join(ROOT, "apps/web/src/app")];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".next") continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) { stack.push(p); continue; }
        if (!/\.tsx?$/.test(e.name) || /\.(test|spec)\.tsx?$/.test(e.name) || e.name === "ModuleGate.tsx") continue;
        for (const m of readFileSync(p, "utf8").matchAll(/moduleKey="([a-z0-9-]+)"/g)) out.add(m[1]!.toLowerCase());
      }
    }
    return out;
  }
  const webKeys = scanWebModuleKeys();

  type Verdict = "platform" | "gated" | "ui-only" | "unclassified";
  function classify(k: string): Verdict {
    if (webPlatform.has(k) || gatewayPlatform.has(k)) return "platform";
    if (hrSwitchKeys.has(k)) return "gated";
    const candidates = new Set([k, ...(webAliases[k] ?? [])]);
    if ([...candidates].some((c) => enforceableKeys.has(c))) return "gated";
    if (k in WEB_UI_ONLY_MODULE_KEYS) return "ui-only";
    return "unclassified";
  }

  it("scans a plausible set of web ModuleGate keys", () => {
    expect(webKeys.size).toBeGreaterThan(20);
  });

  it("every web ModuleGate key is gateway-enforced, platform, or a documented UI-only surface", () => {
    const unclassified = [...webKeys].filter((k) => classify(k) === "unclassified").sort();
    expect(
      unclassified,
      "web gates a module the gateway neither enforces nor treats as platform. Map its route in services/gateway-service/src/module-guard.ts ROUTE_TO_MODULE (catalogue-backed sellable module) or document it in WEB_UI_ONLY_MODULE_KEYS with a reason.",
    ).toEqual([]);
  });

  it("the HR-area switch keys are backed by real catalogue sub-keys", () => {
    for (const need of ["payroll", "hrms-recruitment", "hrms-leave"]) {
      expect(catalogueKeys.has(need), `catalogue must project ${need}`).toBe(true);
    }
  });

  it("documented UI-only keys stay current and are not actually enforced", () => {
    const stale = Object.keys(WEB_UI_ONLY_MODULE_KEYS).filter((k) => !webKeys.has(k)).sort();
    expect(stale, "WEB_UI_ONLY_MODULE_KEYS lists a key no web layout uses anymore - remove it").toEqual([]);
    const wrong = Object.keys(WEB_UI_ONLY_MODULE_KEYS).filter((k) => classify(k) !== "ui-only").sort();
    expect(wrong, "a WEB_UI_ONLY key is now platform/gateway-enforced - stop documenting it as UI-only").toEqual([]);
    for (const [k, reason] of Object.entries(WEB_UI_ONLY_MODULE_KEYS)) expect(reason.length, k).toBeGreaterThan(20);
  });

  it("catalogue-backed service routes are module-gated at the gateway (regression lock)", () => {
    expect(routeEntries.get("revenue"), "map revenue route -> finance in ROUTE_TO_MODULE").toBe("finance");
    expect(routeEntries.get("works"), "map works route -> projects in ROUTE_TO_MODULE").toBe("projects");
    expect(catalogueKeys.has("finance") && catalogueKeys.has("projects")).toBe(true);
    expect(webAliases["revenue"]).toContain("finance");
    expect(webAliases["works"]).toContain("projects");
  });
});
