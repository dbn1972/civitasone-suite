/**
 * ORG-07 — pure domain logic for department template cloning.
 *
 * The one rule that matters: A CLONE MUST NOT CARRY A TENANT-CROSSING
 * REFERENCE. A department config is a nested JSON document that can contain
 * `tenantId` fields and foreign keys copied from wherever the source department
 * lived. `sanitizeTemplateConfig` walks the whole document and strips anything
 * that names a tenant other than the cloning tenant, reporting each removal by
 * path so the operator sees exactly what did not come across.
 *
 * Also here: template-code normalisation and the optimistic-lock guard.
 */
import { HttpError } from "../../shared/context.js";

/** Keys whose VALUE is a tenant identifier. */
const TENANT_KEYS = new Set(["tenantid", "tenant_id", "owningtenantid", "owning_tenant_id"]);

/**
 * Keys that are always local to the tenant they were created in and therefore
 * meaningless (or dangerous) in a clone: they are dropped regardless of value.
 * `id` itself is dropped so an instantiated department never re-uses the source
 * department's primary key.
 */
const LOCAL_ONLY_KEYS = new Set([
  "id", "departmentid", "department_id", "sourcedepartmentid", "source_department_id",
  "createdby", "created_by", "updatedby", "updated_by", "version",
]);

export interface SanitizeResult {
  config: Record<string, unknown>;
  /** Dot-paths that were removed, in the order encountered. */
  droppedRefs: string[];
  /**
   * The subset of `droppedRefs` that named a DIFFERENT tenant — i.e. genuine
   * tenant-crossing references the clone refused to carry. Reported separately
   * because dropping `tenantId: <own tenant>` is housekeeping, while dropping
   * `tenantId: <someone else>` is a security-relevant event.
   */
  crossTenantRefs: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Recursively copy `input`, dropping:
 *   • any tenant-identifying key whose value is NOT `ownTenantId`
 *     (a tenant-crossing reference — the ORG-07 requirement)
 *   • any tenant-identifying key equal to `ownTenantId` (redundant in a
 *     template; the instantiating tenant is always supplied at instantiate time)
 *   • local-only keys (source primary keys, audit columns, version counters)
 * Arrays are walked element-wise so a nested list of objects is cleaned too.
 */
export function sanitizeTemplateConfig(
  input: Record<string, unknown>,
  ownTenantId: string,
): SanitizeResult {
  const droppedRefs: string[] = [];
  const crossTenantRefs: string[] = [];

  function walkObject(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      const lower = key.toLowerCase();
      if (LOCAL_ONLY_KEYS.has(lower)) {
        droppedRefs.push(path);
        continue;
      }
      if (TENANT_KEYS.has(lower)) {
        // Dropped either way; flagged as cross-tenant only when it actually
        // names a tenant other than the one doing the cloning.
        droppedRefs.push(path);
        if (typeof value === "string" && value !== ownTenantId) crossTenantRefs.push(path);
        continue;
      }
      out[key] = walkValue(value, path);
    }
    return out;
  }

  function walkValue(value: unknown, path: string): unknown {
    if (Array.isArray(value)) return value.map((v, i) => walkValue(v, `${path}.${i}`));
    if (isPlainObject(value)) return walkObject(value, path);
    return value;
  }

  // `config` must be built BEFORE the result object is assembled: walkObject is
  // what populates droppedRefs/crossTenantRefs, and property-order evaluation
  // in an object literal would otherwise capture them while still empty.
  const config = walkObject(input, "");
  return { config, droppedRefs, crossTenantRefs };
}

/**
 * True when the config names a tenant other than `ownTenantId` anywhere. Used to
 * decide whether the clone crossed a tenant boundary at all (reported back to
 * the caller, so a silent strip is never invisible).
 */
export function findForeignTenantRefs(input: unknown, ownTenantId: string, prefix = ""): string[] {
  const found: string[] = [];
  if (Array.isArray(input)) {
    input.forEach((v, i) => found.push(...findForeignTenantRefs(v, ownTenantId, `${prefix}.${i}`)));
    return found;
  }
  if (isPlainObject(input)) {
    for (const [key, value] of Object.entries(input)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (TENANT_KEYS.has(key.toLowerCase())) {
        if (typeof value === "string" && value !== ownTenantId) found.push(path);
        continue;
      }
      found.push(...findForeignTenantRefs(value, ownTenantId, path));
    }
  }
  return found;
}

/** Optimistic-lock guard — same contract as the other modules'. */
export function assertVersionMatch(current: number, expected: number | undefined): void {
  if (expected === undefined) return;
  if (current !== expected) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      `version conflict: expected ${expected}, current is ${current}`,
    );
  }
}

/** An archived template cannot be instantiated. */
export function assertTemplateActive(status: string): void {
  if (status !== "active") {
    throw new HttpError(422, "TEMPLATE_NOT_ACTIVE", `template is '${status}' and cannot be instantiated`);
  }
}

/**
 * A template with no configuration left after sanitisation is not worth cloning
 * — it would silently produce an empty department.
 */
export function assertConfigNotEmpty(config: Record<string, unknown>): void {
  if (Object.keys(config).length === 0) {
    throw new HttpError(
      422,
      "EMPTY_TEMPLATE",
      "no cloneable configuration remains after removing tenant-crossing and local-only references",
    );
  }
}
