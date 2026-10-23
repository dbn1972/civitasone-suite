import { createHash } from "node:crypto";
import type { ServiceDefinitionRow } from "../catalogue/schema.js";

/**
 * The fields that define WHAT the service is and does. Bookkeeping (status,
 * version, ids, timestamps, who submitted/published, row version) is excluded:
 * changing those is not a design change, and including them would make every
 * submit/reject cycle invalidate a still-valid test.
 */
const DESIGN_FIELDS = [
  "serviceKey", "serviceId", "name", "ownerDepartment", "servicePattern", "ownerOfficeId",
  "offeringOfficeIds", "workflowDefinitionId", "formId", "feeModel", "hoaCode",
  "statutoryReferences", "engineBindings", "eligibilityRuleSetId", "feeScheduleId",
  "issuanceType", "requiredDocuments", "laneBindings", "slaDays", "channels", "forms",
  "outputs", "allowedApplicantTypes", "applicantTypeRejectMessage",
  "profileAttributeBindings", "officeOverrides", "webhookSubscriptions", "locales",
  "appealLinkage", "rtiLinkage", "renewalPolicy",
] as const;

/** JSON with object keys sorted, so equal designs hash equally regardless of key order. */
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** SHA-256 (hex) over the design-relevant fields of a service definition. */
export function definitionDesignHash(def: Partial<ServiceDefinitionRow>): string {
  const picked: Record<string, unknown> = {};
  for (const f of DESIGN_FIELDS) picked[f] = (def as Record<string, unknown>)[f] ?? null;
  return createHash("sha256").update(canonical(picked)).digest("hex");
}
