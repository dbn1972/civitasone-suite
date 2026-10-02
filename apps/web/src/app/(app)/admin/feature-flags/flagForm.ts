import { z } from "zod";

/**
 * Client-side mirror of admin-service feature-flags createBody/updateBody
 * (services/admin-service/src/modules/feature-flags/routes.ts), so a bad value
 * is caught before the request. GAP-ADMIN-FEATURE-FLAGS-04.
 */
export const flagFormSchema = z.object({
  key: z.string().min(1, "Key is required.").max(128).regex(/^[a-z0-9_-]+$/, "Use lowercase letters, digits, - and _ only."),
  name: z.string().trim().min(1, "Name is required.").max(200),
  description: z.string().max(1000),
  rolloutPercent: z.number({ invalid_type_error: "Rollout must be a whole number from 0 to 100." }).int("Rollout must be a whole number from 0 to 100.").min(0, "Rollout must be a whole number from 0 to 100.").max(100, "Rollout must be a whole number from 0 to 100."),
  targetSegments: z.array(z.string().min(1).max(100)),
  owner: z.string().max(160),
});

export type FlagFormValues = z.infer<typeof flagFormSchema>;

export function parseSegments(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Returns field -> message; empty object when valid. */
export function validateFlagForm(values: unknown): { ok: true; value: FlagFormValues } | { ok: false; errors: Record<string, string> } {
  const r = flagFormSchema.safeParse(values);
  if (r.success) return { ok: true, value: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const k = String(issue.path[0] ?? "form");
    if (!errors[k]) errors[k] = issue.message;
  }
  return { ok: false, errors };
}
