import { z } from "zod";

/**
 * CNR (Case Number Record) format: alphanumeric, typically 16 chars.
 * e.g. "DLHC010012345672026"
 */
export const cnrParam = z.object({
  cnr: z.string().min(1, "cnr is required").max(30, "cnr too long"),
});
