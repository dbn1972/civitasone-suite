/**
 * Module composition — pure, side-effect-free dependency resolution.
 *
 * The platform is composable: a tenant enables only the modules it needs
 * (e.g. "Payroll only" or "just add/update employees"). Modules declare a
 * dependency graph:
 *   hardDeps — MUST be present for the module to function; enabling a module
 *              transitively pulls its hard deps in (source "dep"), and a module
 *              cannot be disabled while another enabled module hard-depends on it.
 *   softDeps — used opportunistically if present, but the module degrades
 *              gracefully without them (e.g. Payroll reads Attendance/Leave for
 *              LOP if enabled, else accepts a manual/imported LOP input). Soft
 *              deps are advisory only and never auto-enable or block.
 *
 * "Core" modules are always on and can never be disabled. The persisted
 * source-of-truth is the set of USER selections; core + dep are always derived
 * here, so disabling a module automatically garbage-collects deps that are no
 * longer required. Deterministic and total.
 */

export interface ModuleDef {
  id: string;
  name: string;
  layer: number;
  isCore: boolean;
  hardDeps: string[];
  softDeps: string[];
  screens: string[];
  sortOrder: number;
}

export type Registry = Map<string, ModuleDef>;

export type Source = "core" | "user" | "dep";

export interface CompositionEntry {
  id: string;
  source: Source;
}

export interface Composition {
  entries: CompositionEntry[];
  moduleIds: string[];
  screens: string[];
}

export class CompositionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CompositionError";
  }
}

/** Build a registry from module defs; validates dep references and cycles. */
export function buildRegistry(mods: ModuleDef[]): Registry {
  const reg: Registry = new Map();
  for (const m of mods) {
    if (reg.has(m.id)) throw new CompositionError("DUPLICATE_MODULE", `duplicate module id: ${m.id}`);
    reg.set(m.id, m);
  }
  // every declared dep must exist
  for (const m of reg.values()) {
    for (const d of [...m.hardDeps, ...m.softDeps]) {
      if (!reg.has(d)) throw new CompositionError("UNKNOWN_DEP", `module ${m.id} references unknown dependency ${d}`);
    }
  }
  assertNoHardCycle(reg);
  return reg;
}

/** Depth-first cycle detection over the hard-dependency edges. */
function assertNoHardCycle(reg: Registry): void {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of reg.keys()) color.set(id, WHITE);
  const visit = (id: string, path: string[]): void => {
    color.set(id, GREY);
    for (const d of reg.get(id)!.hardDeps) {
      const c = color.get(d);
      if (c === GREY) throw new CompositionError("CYCLE", `hard-dependency cycle: ${[...path, id, d].join(" -> ")}`);
      if (c === WHITE) visit(d, [...path, id]);
    }
    color.set(id, BLACK);
  };
  for (const id of reg.keys()) if (color.get(id) === WHITE) visit(id, []);
}

function requireModule(reg: Registry, id: string): ModuleDef {
  const m = reg.get(id);
  if (!m) throw new CompositionError("UNKNOWN_MODULE", `unknown module: ${id}`);
  return m;
}

/** Ids of all core modules. */
export function coreIds(reg: Registry): string[] {
  return [...reg.values()].filter((m) => m.isCore).map((m) => m.id);
}

/** Transitive set of hard dependencies of the given seed ids (excludes seeds). */
export function hardClosure(reg: Registry, seed: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [];
  for (const id of seed) {
    requireModule(reg, id);
    for (const d of reg.get(id)!.hardDeps) stack.push(d);
  }
  while (stack.length) {
    const id = stack.pop()!;
    requireModule(reg, id);
    if (out.has(id)) continue;
    out.add(id);
    for (const d of reg.get(id)!.hardDeps) if (!out.has(d)) stack.push(d);
  }
  return out;
}

/**
 * Resolve the full composition for a set of user-selected module ids.
 * Core modules are always included; hard deps are pulled in as "dep".
 * Unknown user ids throw. Ordering is layer, then sortOrder, then id.
 */
export function resolveComposition(reg: Registry, userIds: readonly string[]): Composition {
  for (const id of userIds) requireModule(reg, id);
  const core = new Set(coreIds(reg));
  // a user pick that is actually a core module is folded into core (stays "core")
  const user = new Set([...userIds].filter((id) => !core.has(id)));
  const closure = hardClosure(reg, new Set<string>([...core, ...user]));
  const dep = new Set<string>();
  for (const d of closure) if (!core.has(d) && !user.has(d)) dep.add(d);

  const entries: CompositionEntry[] = [...reg.values()]
    .filter((m) => core.has(m.id) || user.has(m.id) || dep.has(m.id))
    .sort((a, b) => a.layer - b.layer || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((m) => ({
      id: m.id,
      source: core.has(m.id) ? "core" : user.has(m.id) ? "user" : "dep",
    }));

  const screens: string[] = [];
  for (const e of entries) for (const s of reg.get(e.id)!.screens) screens.push(s);

  return { entries, moduleIds: entries.map((e) => e.id), screens };
}

/** New user set after enabling a module (idempotent). Core enable is a no-op. */
export function applyEnable(reg: Registry, userIds: readonly string[], moduleId: string): string[] {
  const m = requireModule(reg, moduleId);
  if (m.isCore) return dedupeKnownUser(reg, userIds);
  return dedupeKnownUser(reg, [...userIds, moduleId]);
}

export interface DisableResult {
  ok: boolean;
  /** user modules that hard-depend on moduleId (why it can't be disabled); "__core__" if core. */
  blockers: string[];
}

/** Can this module be disabled given the current user selections? */
export function canDisable(reg: Registry, userIds: readonly string[], moduleId: string): DisableResult {
  const m = requireModule(reg, moduleId);
  if (m.isCore) return { ok: false, blockers: ["__core__"] };
  const blockers: string[] = [];
  for (const uid of userIds) {
    if (uid === moduleId || !reg.has(uid)) continue;
    if (hardClosure(reg, [uid]).has(moduleId)) blockers.push(uid);
  }
  return { ok: blockers.length === 0, blockers };
}

/** New user set after disabling a module; throws COMPOSITION_BLOCKED if depended on. */
export function applyDisable(reg: Registry, userIds: readonly string[], moduleId: string): string[] {
  const res = canDisable(reg, userIds, moduleId);
  if (!res.ok) {
    throw new CompositionError("COMPOSITION_BLOCKED", `cannot disable ${moduleId}: required by ${res.blockers.join(", ")}`);
  }
  return dedupeKnownUser(reg, userIds.filter((id) => id !== moduleId));
}

/** Dedupe + drop core ids (core is implicit) + validate existence. */
function dedupeKnownUser(reg: Registry, ids: readonly string[]): string[] {
  const core = new Set(coreIds(reg));
  const out = new Set<string>();
  for (const id of ids) {
    requireModule(reg, id);
    if (!core.has(id)) out.add(id);
  }
  return [...out].sort();
}
