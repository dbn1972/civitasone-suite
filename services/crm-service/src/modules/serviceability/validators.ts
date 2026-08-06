/**
 * G20 — Serviceability query param validation.
 */
import { z } from "zod";

/**
 * Indian PIN codes are 6 digits. articleType is a free-form string (the adapter
 * defines valid values — CRM doesn't gate them beyond non-empty).
 */
const PIN_PATTERN = /^\d{6}$/;

export const serviceabilityQuery = z.object({
  originPin: z.string().regex(PIN_PATTERN, "must be a 6-digit PIN code"),
  destinationPin: z.string().regex(PIN_PATTERN, "must be a 6-digit PIN code"),
  articleType: z.string().min(1, "articleType is required").max(50),
});

export type ServiceabilityQuery = z.infer<typeof serviceabilityQuery>;
