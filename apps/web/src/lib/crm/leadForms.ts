/**
 * Lead-capture form registry client (LM-002, GAP-CRM-LEAD-FORMS-01).
 *
 * The admin screen must be able to register, amend, pause and re-enable public
 * lead-capture forms, and fix a consent gap — the registry page previously had
 * no write control at all. All calls route through the BFF proxy via
 * browserFetch (httpOnly session, device headers); the crm-service routes
 * (capture-forms-routes.ts) are ADMIN-only and remain the authority.
 *
 * Mutations are CQRS (202 Accepted); create additionally returns the minted
 * public form key so the caller can show the embed URL immediately.
 *
 * NOTE: crm-service exposes no key-rotation endpoint today, so this client
 * intentionally offers no rotateKey() — see the fixer report decision.
 */
import { z } from "zod";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

const originEntry = z
  .string()
  .trim()
  .max(255)
  .regex(/^https?:\/\/[^/\s]+$/, "Each origin must be a scheme+host, e.g. https://example.gov.in");

/** Shared, client-side mirror of crm-service's createCaptureFormBody bounds. */
export const leadFormInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  enabled: z.boolean().optional(),
  requireConsent: z.boolean().optional(),
  allowedOrigins: z.array(originEntry).max(50).optional(),
  defaultLeadSource: z.string().trim().min(1).max(64).optional(),
  maxPerMinute: z.number().int().min(1).max(600).optional(),
});
export type LeadFormInput = z.infer<typeof leadFormInputSchema>;

/** At least one field; mirrors the service's updateCaptureFormBody refine. */
export const leadFormUpdateSchema = leadFormInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type LeadFormUpdate = z.infer<typeof leadFormUpdateSchema>;

/** Create's 202 envelope with the minted key (acceptedResponseSchema.passthrough()). */
const createAcceptedSchema = z
  .object({ status: z.string().optional(), formKey: z.string().optional() })
  .passthrough();

export interface CreateLeadFormResult {
  /** The minted public form key, when the service returned it. */
  formKey?: string;
}

/** Register a new form; returns the minted key when present. Validates at the boundary. */
export async function createLeadForm(input: LeadFormInput): Promise<CreateLeadFormResult> {
  const body = leadFormInputSchema.parse(input);
  const res = await browserFetch("v1/crm/lead-capture-forms", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  let formKey: string | undefined;
  try {
    const parsed = createAcceptedSchema.parse(await res.json());
    formKey = typeof parsed.formKey === "string" ? parsed.formKey : undefined;
  } catch {
    /* envelope shape tolerated — the key is a bonus, the list reload shows the row */
  }
  return { formKey };
}

/** Amend a form's policy (name, origins, consent, source, rate, enabled). */
export async function updateLeadForm(id: string, patch: LeadFormUpdate): Promise<void> {
  const body = leadFormUpdateSchema.parse(patch);
  const res = await browserFetch(`v1/crm/lead-capture-forms/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/** Pause (enabled=false) or resume (enabled=true) a form. */
export async function setLeadFormEnabled(id: string, enabled: boolean): Promise<void> {
  return updateLeadForm(id, { enabled });
}

/** Fix a consent gap by requiring consent (or deliberately clearing it). */
export async function setLeadFormConsent(id: string, requireConsent: boolean): Promise<void> {
  return updateLeadForm(id, { requireConsent });
}
