import { z } from "zod";

/**
 * GAP-PLATFORM-ADMIN-ORG-CONFIG-04/06: validation + colour helpers for the
 * org-hierarchy-LEVEL editor (platform-admin/org-config). Kept out of the
 * "use client" component so the pure logic is unit-testable without rendering.
 * (Named orgLevels, distinct from lib/orgConfig.ts which is the unrelated
 * org-TYPE terminology config.)
 */

export const ORG_LEVEL_FALLBACK_COLOR = "#334155";
const SIX_HEX = /^#[0-9a-fA-F]{6}$/;
const THREE_HEX = /^#[0-9a-fA-F]{3}$/;

/**
 * ORG-CONFIG-04: a loader value may be any string (admin-service stores a hex,
 * but a 3-digit hex, rgb()/hsl()/var() or a named colour would break the
 * `color + "18"` alpha-suffix concatenation the UI used). Normalise to a safe
 * 6-digit hex, expanding a 3-digit hex and falling back to the default for
 * anything else.
 */
export function normalizeHexColor(value: string | null | undefined): string {
  if (!value) return ORG_LEVEL_FALLBACK_COLOR;
  const v = value.trim();
  if (SIX_HEX.test(v)) return v.toLowerCase();
  if (THREE_HEX.test(v)) {
    const [, r, g, b] = /^#(.)(.)(.)$/.exec(v)!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return ORG_LEVEL_FALLBACK_COLOR;
}

/**
 * ORG-CONFIG-04: produce a valid `rgba()` tint from a hex colour at the given
 * alpha (0..1), expanding/validating the hex first. Replaces the previous
 * `color + "18"` string concatenation that produced invalid CSS for any
 * non-6-digit-hex input.
 *
 *   tint("#1e40af", 0.1) -> "rgba(30, 64, 175, 0.1)"
 *   tint("#abc", 0.1)    -> "rgba(170, 187, 204, 0.1)"
 *   tint("rgb(1,2,3)",1) -> fallback colour's rgba
 */
export function tint(hex: string | null | undefined, alpha: number): string {
  const safe = normalizeHexColor(hex);
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * ORG-CONFIG-06: validate a single draft level. label 1..60 chars (trimmed),
 * description/examples optional up to 200 chars. Colour normalised separately.
 */
export const OrgLevelDraftSchema = z.object({
  label: z.string().trim().min(1, "Level name is required.").max(60, "Level name must be 60 characters or fewer."),
  description: z.string().max(200, "Description must be 200 characters or fewer.").optional().default(""),
  examples: z.string().max(200, "Examples must be 200 characters or fewer.").optional().default(""),
});

export type OrgLevelDraftInput = {
  id: string;
  label: string;
  description?: string;
  examples?: string;
};

export type OrgLevelValidationResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * ORG-CONFIG-06: validate the whole level set before persisting: each label
 * within length bounds, and labels unique case-insensitively (so
 * "Division"/"division" is rejected).
 */
export function validateOrgLevels(levels: OrgLevelDraftInput[]): OrgLevelValidationResult {
  for (const l of levels) {
    const parsed = OrgLevelDraftSchema.safeParse(l);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid level." };
    }
  }
  const seen = new Set<string>();
  for (const l of levels) {
    const key = l.label.trim().toLowerCase();
    if (seen.has(key)) {
      return { ok: false, message: `Duplicate level name "${l.label.trim()}". Level names must be unique.` };
    }
    seen.add(key);
  }
  return { ok: true };
}
