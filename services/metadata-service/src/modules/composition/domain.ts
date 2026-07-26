/**
 * Low-code module composition (CAP-111 low-code composition, CAP-114 configurator).
 *
 * A "module composition" assembles a runnable module from references to existing
 * metadata artifacts — entity definitions, their layouts, and workflow keys —
 * plus a navigation ordering. This module validates a proposed composition
 * against the set of artifacts that actually exist in the tenant, so a
 * composition can never reference a missing entity/layout. Pure and
 * side-effect-free; persistence lives in `routes.ts`.
 */

export interface CompositionLayoutRef {
  entity: string;      // entity apiName
  layoutId: string;    // layout_definitions.id
}

export interface CompositionNavItem {
  entity: string;      // entity apiName
  label: string;
  order?: number;
}

export interface CompositionDefinition {
  entities: string[];                    // entity apiNames included in the module
  layouts?: CompositionLayoutRef[];      // entity -> layout binding
  workflows?: string[];                  // workflow keys wired to the module
  navigation?: CompositionNavItem[];     // nav ordering (must reference included entities)
}

export interface CompositionRefs {
  entityApiNames: Set<string>;   // entities that exist in the tenant
  layoutIds: Set<string>;        // layout ids that exist in the tenant
  workflowKeys?: Set<string>;    // optional: known workflow keys
}

export interface CompositionValidationResult {
  valid: boolean;
  errors: string[];
}

const API_NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Validate a composition definition against the artifacts available in a tenant.
 * Returns a structured result (never throws) listing every problem found.
 */
export function validateComposition(
  def: CompositionDefinition,
  refs: CompositionRefs,
): CompositionValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(def.entities) || def.entities.length === 0) {
    errors.push("composition must include at least one entity");
  } else {
    const seen = new Set<string>();
    for (const e of def.entities) {
      if (typeof e !== "string" || !API_NAME_RE.test(e)) {
        errors.push(`invalid entity apiName: ${String(e)}`);
        continue;
      }
      if (seen.has(e)) errors.push(`duplicate entity in composition: ${e}`);
      seen.add(e);
      if (!refs.entityApiNames.has(e)) errors.push(`unknown entity: ${e}`);
    }
  }

  const includedEntities = new Set(def.entities ?? []);

  for (const l of def.layouts ?? []) {
    if (!l || typeof l.entity !== "string" || typeof l.layoutId !== "string") {
      errors.push("layout ref must have { entity, layoutId }");
      continue;
    }
    if (!includedEntities.has(l.entity)) errors.push(`layout references entity not in composition: ${l.entity}`);
    if (!refs.layoutIds.has(l.layoutId)) errors.push(`unknown layout: ${l.layoutId}`);
  }

  for (const nav of def.navigation ?? []) {
    if (!nav || typeof nav.entity !== "string") {
      errors.push("navigation item must have an entity");
      continue;
    }
    if (!includedEntities.has(nav.entity)) errors.push(`navigation references entity not in composition: ${nav.entity}`);
  }

  if (def.workflows && refs.workflowKeys) {
    for (const w of def.workflows) {
      if (!refs.workflowKeys.has(w)) errors.push(`unknown workflow: ${w}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
