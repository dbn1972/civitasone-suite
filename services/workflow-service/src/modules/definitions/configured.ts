import * as repo from "./repo.js";

/**
 * F77: the explicit error for "this tenant has no active workflow definition
 * for the requested code". Before, a missing definition only surfaced as an
 * async R13 `rejected` instance, so the caller saw a 202 and its record then
 * sat unapprovable with no reason given.
 */
export const WORKFLOW_NOT_CONFIGURED = "WORKFLOW_NOT_CONFIGURED";

export function workflowNotConfiguredMessage(code: string): string {
  return `workflow definition '${code}' is not configured for this tenant`;
}

/** True when the tenant has an ACTIVE definition for `code` (the one createInstance resolves). */
export async function isDefinitionConfigured(tenantId: string, code: string): Promise<boolean> {
  return (await repo.findByCode(tenantId, code)) !== null;
}
