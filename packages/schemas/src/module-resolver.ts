import { MODULE_MANIFEST, type ModuleDef } from "./module-manifest.js";

export interface ResolutionResult {
  /** Final set of enabled modules (user-selected + auto-resolved dependencies) */
  enabledModules: string[];
  /** Modules that were auto-added as dependencies (not explicitly selected by user) */
  autoEnabled: Array<{ module: string; reason: string; mode: "full" | "thin" }>;
  /** Foundation modules (always included) */
  foundation: string[];
  /** Any circular dependency warnings */
  warnings: string[];
}

/**
 * Parses a dependency string into module ID and optional sub-module.
 * e.g. "hrms:employees" → { moduleId: "hrms", subModule: "employees" }
 *      "procurement"    → { moduleId: "procurement", subModule: undefined }
 */
function parseDep(dep: string): { moduleId: string; subModule: string | undefined } {
  const [moduleId, subModule] = dep.split(":");
  return { moduleId: moduleId!, subModule };
}

/**
 * Builds a lookup map from module ID to its definition.
 */
function buildModuleMap(manifest: ModuleDef[]): Map<string, ModuleDef> {
  const map = new Map<string, ModuleDef>();
  for (const mod of manifest) {
    map.set(mod.id, mod);
  }
  return map;
}

/**
 * Detects cycles in the dependency graph using DFS.
 * Returns a list of cycle descriptions (if any).
 */
function detectCycles(manifest: ModuleDef[]): string[] {
  const warnings: string[] = [];
  const moduleMap = buildModuleMap(manifest);

  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const mod of manifest) {
    color.set(mod.id, WHITE);
  }

  function dfs(nodeId: string, path: string[]): void {
    color.set(nodeId, GRAY);
    const mod = moduleMap.get(nodeId);
    if (!mod) return;

    for (const dep of mod.requires) {
      const { moduleId } = parseDep(dep);
      const nodeColor = color.get(moduleId);
      if (nodeColor === GRAY) {
        const cycleStart = path.indexOf(moduleId);
        const cycle = [...path.slice(cycleStart), moduleId];
        warnings.push(`Circular dependency detected: ${cycle.join(" → ")}`);
      } else if (nodeColor === WHITE) {
        dfs(moduleId, [...path, moduleId]);
      }
    }

    color.set(nodeId, BLACK);
  }

  for (const mod of manifest) {
    if (color.get(mod.id) === WHITE) {
      dfs(mod.id, [mod.id]);
    }
  }

  return warnings;
}

/**
 * Resolves the full set of enabled modules given a user's selection.
 * Auto-enables dependencies, distinguishes "thin" (API-only) vs "full" (with UI).
 *
 * Rules:
 * 1. Foundation modules are always included (not selectable)
 * 2. If user selects "payroll", dependencies like "hrms:employees" are auto-resolved
 * 3. A sub-module dependency (e.g. "hrms:employees") enables the parent service
 *    in "thin" mode (API only) unless the user explicitly selected the full module
 * 4. Circular dependencies are detected and reported as warnings
 * 5. The resolver is idempotent — running it twice yields the same result
 */
export function resolveModules(userSelected: string[]): ResolutionResult {
  const moduleMap = buildModuleMap(MODULE_MANIFEST);
  const foundation = MODULE_MANIFEST
    .filter((m) => m.foundation)
    .map((m) => m.id);

  // Normalize user selection: extract module IDs (handle "module:submodule" in selection)
  const userSelectedModuleIds = new Set<string>();
  for (const sel of userSelected) {
    const { moduleId } = parseDep(sel);
    userSelectedModuleIds.add(moduleId);
  }

  // Track which modules are enabled and why
  const enabledSet = new Set<string>(foundation);
  const autoEnabled: Array<{ module: string; reason: string; mode: "full" | "thin" }> = [];

  // Add all user-selected modules
  for (const moduleId of userSelectedModuleIds) {
    enabledSet.add(moduleId);
  }

  // BFS/iterative resolution of dependencies
  // depString preserves the original dependency format ("hrms:employees" vs "procurement")
  const queue: Array<{ moduleId: string; requiredBy: string; depString: string }> = [];

  // Seed the queue with dependencies of user-selected modules
  for (const moduleId of userSelectedModuleIds) {
    const mod = moduleMap.get(moduleId);
    if (!mod) continue;
    for (const dep of mod.requires) {
      const { moduleId: depModuleId } = parseDep(dep);
      queue.push({ moduleId: depModuleId, requiredBy: moduleId, depString: dep });
    }
  }

  // Track visited to avoid infinite loops
  const visited = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { moduleId: depModuleId, requiredBy, depString } = item;
    const visitKey = `${depModuleId}:${requiredBy}`;

    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    if (!enabledSet.has(depModuleId)) {
      enabledSet.add(depModuleId);

      // Determine mode:
      // - If user explicitly selected this module → full (handled by not being in autoEnabled)
      // - If dependency was "module:submodule" → thin (only API/data layer needed)
      // - If dependency was "module" (full reference) → full
      const isSubModuleDep = depString.includes(":");
      const mode: "full" | "thin" = isSubModuleDep ? "thin" : "full";
      const requiredByMod = moduleMap.get(requiredBy);
      const reason = `Required by ${requiredByMod?.name ?? requiredBy}`;
      autoEnabled.push({ module: depModuleId, reason, mode });
    }

    // Recursively resolve this dependency's own dependencies
    const depMod = moduleMap.get(depModuleId);
    if (depMod) {
      for (const transitiveDep of depMod.requires) {
        const { moduleId: transitiveModuleId } = parseDep(transitiveDep);
        queue.push({ moduleId: transitiveModuleId, requiredBy: depModuleId, depString: transitiveDep });
      }
    }
  }

  // Check for cycles in the full manifest
  const warnings = detectCycles(MODULE_MANIFEST);

  // Sort enabled modules for deterministic output
  const enabledModules = [...enabledSet].sort();

  return {
    enabledModules,
    autoEnabled,
    foundation: foundation.sort(),
    warnings,
  };
}

/**
 * Validates that a proposed module set is consistent (no unmet dependencies).
 * Used to validate existing plan configurations.
 */
export function validateModuleSet(
  modules: string[],
): { valid: boolean; unmet: Array<{ module: string; missing: string }> } {
  const moduleMap = buildModuleMap(MODULE_MANIFEST);
  const enabledSet = new Set<string>(modules);

  // Always include foundation modules in the check
  const foundation = MODULE_MANIFEST
    .filter((m) => m.foundation)
    .map((m) => m.id);
  for (const f of foundation) {
    enabledSet.add(f);
  }

  const unmet: Array<{ module: string; missing: string }> = [];

  for (const moduleId of modules) {
    const mod = moduleMap.get(moduleId);
    if (!mod) continue;

    for (const dep of mod.requires) {
      const { moduleId: depModuleId } = parseDep(dep);
      if (!enabledSet.has(depModuleId)) {
        unmet.push({ module: moduleId, missing: dep });
      }
    }
  }

  return { valid: unmet.length === 0, unmet };
}

/**
 * Returns the dependency tree for UI display.
 * Shows what enabling a module would also enable.
 */
export function previewDependencies(
  moduleId: string,
): Array<{ module: string; reason: string; mode: "full" | "thin" }> {
  const moduleMap = buildModuleMap(MODULE_MANIFEST);
  const mod = moduleMap.get(moduleId);
  if (!mod) return [];

  const result: Array<{ module: string; reason: string; mode: "full" | "thin" }> = [];
  const visited = new Set<string>();
  visited.add(moduleId); // Don't include the module itself

  const queue: Array<{ depModuleId: string; requiredBy: string; depString: string }> = [];

  // Seed with direct dependencies
  for (const dep of mod.requires) {
    const { moduleId: depModuleId } = parseDep(dep);
    queue.push({ depModuleId, requiredBy: moduleId, depString: dep });
  }

  while (queue.length > 0) {
    const { depModuleId, requiredBy, depString } = queue.shift()!;

    if (visited.has(depModuleId)) continue;
    visited.add(depModuleId);

    const requiredByMod = moduleMap.get(requiredBy);
    const reason = `Required by ${requiredByMod?.name ?? requiredBy}`;

    // If the dependency was specified as "module:submodule", it's thin mode
    const isSubModuleDep = depString.includes(":");
    const mode: "full" | "thin" = isSubModuleDep ? "thin" : "full";

    result.push({ module: depModuleId, reason, mode });

    // Resolve transitive dependencies
    const depMod = moduleMap.get(depModuleId);
    if (depMod) {
      for (const transitiveDep of depMod.requires) {
        const { moduleId: transitiveId } = parseDep(transitiveDep);
        if (!visited.has(transitiveId)) {
          queue.push({ depModuleId: transitiveId, requiredBy: depModuleId, depString: transitiveDep });
        }
      }
    }
  }

  return result;
}
