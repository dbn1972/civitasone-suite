/**
 * M6 — plan -> catalogue modules.
 *
 * A subscription plan is sold as a SET OF CATALOGUE MODULES. This is the one pure function that turns what a plan
 * stores into that set, resolved with the catalogue's hard dependencies (module-catalogue.ts), so a plan can never
 * hand a tenant a module without the modules it cannot work without.
 *
 * What a plan stores (plans.plans):
 *   - catalogue_modules  explicit catalogue module ids (preferred; lets a plan be "HRMS without Recruitment");
 *   - enabled_modules    the older product ids ("hrms", "finance", ...). Used only when catalogue_modules is null:
 *                        each product expands through PRODUCT_TO_CATALOGUE, so every existing plan keeps its meaning.
 *
 * Pure: no I/O. The apply path (admin-service composition apply-plan) re-resolves the result against the registry.
 */
import { CATALOGUE_BY_ID, MODULE_CATALOGUE } from "./module-catalogue.js";
import { MODULE_MANIFEST, PRODUCT_TO_CATALOGUE } from "./module-manifest.js";

export class PlanModuleError extends Error {
  constructor(public readonly code: "UNKNOWN_PLAN_MODULE" | "EMPTY_PLAN_MODULES", message: string) {
    super(message);
    this.name = "PlanModuleError";
  }
}

export interface PlanModuleSource {
  /** Explicit catalogue module ids. null/undefined = derive from enabledModules. */
  readonly catalogueModules?: readonly string[] | null;
  /** Product ids ("hrms", "finance", ...), the older plan field. */
  readonly enabledModules: readonly string[];
}

export interface PlanModuleResolution {
  /** Where the set came from. */
  readonly source: "catalogue_modules" | "enabled_modules";
  /** Catalogue modules the plan names itself (non-core, deduped, catalogue order). */
  readonly selected: readonly string[];
  /** Hard dependencies pulled in that the plan did not name (non-core). */
  readonly pulledIn: readonly string[];
  /** selected + pulledIn: the modules the tenant ends up with (non-core, catalogue order). */
  readonly moduleIds: readonly string[];
  /** Core modules the closure also needs (always on for every tenant; informational). */
  readonly coreModules: readonly string[];
}

/** Product ids that are real manifest entries but not sellable catalogue modules (theme, ml, ...). */
const MANIFEST_ONLY = new Set(MODULE_MANIFEST.map((m) => m.id).filter((id) => !(id in PRODUCT_TO_CATALOGUE)));

const ORDER = new Map(MODULE_CATALOGUE.map((m, i) => [m.id, i]));
const byCatalogueOrder = (a: string, b: string): number => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0);

function expandProducts(products: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of products) {
    const mapped = PRODUCT_TO_CATALOGUE[p];
    if (mapped) out.push(...mapped);
    else if (CATALOGUE_BY_ID.has(p)) out.push(p); // an older plan that already stores a catalogue id
    else if (!MANIFEST_ONLY.has(p)) {
      throw new PlanModuleError("UNKNOWN_PLAN_MODULE", `unknown plan module: ${p}`);
    }
  }
  return out;
}


export function resolvePlanModules(plan: PlanModuleSource): PlanModuleResolution {
  const explicit = plan.catalogueModules ?? null;
  let named: string[];
  if (explicit !== null) {
    for (const id of explicit) {
      if (!CATALOGUE_BY_ID.has(id)) throw new PlanModuleError("UNKNOWN_PLAN_MODULE", `unknown catalogue module: ${id}`);
    }
    named = [...explicit];
  } else {
    named = expandProducts(plan.enabledModules);
  }
  const selected = [...new Set(named)].filter((id) => !CATALOGUE_BY_ID.get(id)!.isCore);

  const all = new Set<string>(selected);
  const core = new Set<string>();
  const queue = [...selected];
  while (queue.length > 0) {
    const m = CATALOGUE_BY_ID.get(queue.pop()!)!;
    for (const dep of m.hardDeps) {
      const d = CATALOGUE_BY_ID.get(dep);
      if (!d) throw new PlanModuleError("UNKNOWN_PLAN_MODULE", `catalogue dependency ${dep} of ${m.id} is not in the catalogue`);
      if (d.isCore) { core.add(dep); continue; }
      if (!all.has(dep)) { all.add(dep); queue.push(dep); }
    }
  }
  const chosen = new Set(selected);
  return {
    source: explicit !== null ? "catalogue_modules" : "enabled_modules",
    selected: selected.slice().sort(byCatalogueOrder),
    pulledIn: [...all].filter((id) => !chosen.has(id)).sort(byCatalogueOrder),
    moduleIds: [...all].sort(byCatalogueOrder),
    coreModules: [...core].sort(byCatalogueOrder),
  };
}
