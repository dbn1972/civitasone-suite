/**
 * GIGW 3.0 site identity per tenant (UAT b23 onboarding gap): the web footer
 * and GIGW pages used to read the owning department only from build-time
 * NEXT_PUBLIC_GIGW_* env, so every tenant showed the same owner. The values now
 * live in the tenant's own setting `gigw.identity` (set by a tenant admin via
 * PUT /v1/settings) and are read by any signed-in user of that tenant through
 * GET /v1/tenant/gigw-identity. These are public-facing contact details (no
 * secret), so the read is not admin-gated; it is tenant-scoped by RLS and the
 * caller's own tenant id, never a tenant id from the request.
 */
import { z } from "zod";

export const GIGW_IDENTITY_KEY = "gigw.identity";

const text = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? undefined : v)).optional();

/** Field names match the web's GigwConfigField. Unknown keys are rejected on write. */
export const gigwIdentitySchema = z.object({
  department: text(200),
  address: text(500),
  wimDesignation: text(200),
  wimEmail: text(200),
  wimPhone: text(50),
  helpdeskEmail: text(200),
  helpdeskPhone: text(50),
  helpdeskHours: text(200),
  pioContact: text(300),
  faaContact: text(300),
  reviewedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "reviewedAt must be YYYY-MM-DD").optional(),
}).strict();
export type GigwIdentity = z.infer<typeof gigwIdentitySchema>;

/** Whitelist a stored value; anything that does not parse yields null (the web falls back to its build-time config). */
export function readGigwIdentity(stored: unknown): GigwIdentity | null {
  const parsed = gigwIdentitySchema.safeParse(stored);
  if (!parsed.success) return null;
  return Object.values(parsed.data).some((v) => v !== undefined) ? parsed.data : null;
}
