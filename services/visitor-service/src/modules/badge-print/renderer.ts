/**
 * visitor-service: badge-print — badge template renderer (pure functions).
 *
 * Owns:
 *   - Supported placeholder constant list (12 placeholders)
 *   - Template placeholder validation (extract {{word}} patterns, reject unsupported)
 *   - Badge rendering (substitute all placeholders with visitor data)
 *   - Post-render validation (check for unsubstituted placeholders)
 *
 * All functions are pure (no side effects, no DB/Redis calls). Templates use
 * ZPL (Zebra) or ESC/POS (thermal) printer language with {{placeholder_name}}
 * variable syntax. Rendering is server-side — devices receive fully resolved
 * print commands and require no template logic.
 *
 * Requirements validated: 4.2, 4.3, 5.8, 5.9
 */

// ---------------------------------------------------------------------------
// Supported Placeholders
// ---------------------------------------------------------------------------

/**
 * All supported variable placeholders for badge templates.
 *
 * These correspond to visitor pass data fields that are substituted at render time.
 * Any placeholder in a template body that is not in this list is considered invalid.
 */
export const SUPPORTED_PLACEHOLDERS = [
  "visitor_name",
  "visitor_photo_base64",
  "host_name",
  "host_department",
  "qr_code_data",
  "permitted_areas",
  "valid_from",
  "valid_until",
  "visitor_category",
  "badge_color_hex",
  "pass_number",
  "organization_logo",
] as const;

/** Union type of all supported placeholder key strings. */
export type PlaceholderKey = (typeof SUPPORTED_PLACEHOLDERS)[number];

// ---------------------------------------------------------------------------
// Placeholder Regex
// ---------------------------------------------------------------------------

/**
 * Regex to match all {{word}} patterns in a template body.
 * Captures the placeholder name (one or more word characters) inside the braces.
 */
const PLACEHOLDER_REGEX = /\{\{(\w+)\}\}/g;

// ---------------------------------------------------------------------------
// Template Validation
// ---------------------------------------------------------------------------

/**
 * Validate that all placeholders in a template body are from the supported set.
 *
 * Extracts every `{{word}}` pattern from the template and checks each against
 * SUPPORTED_PLACEHOLDERS. Returns invalid ones if any are not recognized.
 *
 * @param templateBody - The raw template content (ZPL or ESC/POS) with variable placeholders
 * @returns Object with `valid` flag and array of any `invalidPlaceholders` found
 *
 * @example
 * ```typescript
 * validateTemplatePlaceholders("Hello {{visitor_name}} from {{unknown_field}}")
 * // → { valid: false, invalidPlaceholders: ["unknown_field"] }
 * ```
 */
export function validateTemplatePlaceholders(templateBody: string): {
  valid: boolean;
  invalidPlaceholders: string[];
} {
  const supportedSet = new Set<string>(SUPPORTED_PLACEHOLDERS);
  const invalidPlaceholders: string[] = [];

  let match: RegExpExecArray | null;
  const regex = new RegExp(PLACEHOLDER_REGEX.source, PLACEHOLDER_REGEX.flags);

  while ((match = regex.exec(templateBody)) !== null) {
    const placeholder = match[1]!;
    if (!supportedSet.has(placeholder) && !invalidPlaceholders.includes(placeholder)) {
      invalidPlaceholders.push(placeholder);
    }
  }

  return {
    valid: invalidPlaceholders.length === 0,
    invalidPlaceholders,
  };
}

// ---------------------------------------------------------------------------
// Badge Rendering
// ---------------------------------------------------------------------------

/**
 * Render a badge by substituting all placeholders in the template with visitor data.
 *
 * Replaces every `{{placeholder_name}}` occurrence with the corresponding value
 * from the data record. If a placeholder key is present in the template but missing
 * from the data, it defaults to an empty string — ensuring the output never contains
 * raw placeholder syntax for known keys.
 *
 * @param templateBody - The raw template content with {{placeholder}} variables
 * @param data - Record mapping placeholder keys to their substitution values
 * @returns The fully rendered print command (ZPL or ESC/POS) with all variables substituted
 *
 * @example
 * ```typescript
 * renderBadge("^FD{{visitor_name}}^FS", { visitor_name: "Jane Doe", ... })
 * // → "^FDJane Doe^FS"
 * ```
 */
export function renderBadge(
  templateBody: string,
  data: Partial<Record<PlaceholderKey, string>>,
): string {
  return templateBody.replace(PLACEHOLDER_REGEX, (_match, placeholder: string) => {
    const key = placeholder as PlaceholderKey;
    return data[key] ?? "";
  });
}

// ---------------------------------------------------------------------------
// Post-Render Validation
// ---------------------------------------------------------------------------

/**
 * Check whether any unsubstituted `{{word}}` placeholders remain in the rendered output.
 *
 * Used as a post-render validation step to detect template errors or data mismatches.
 * Returns true if at least one `{{word}}` pattern is found — indicating incomplete rendering.
 *
 * @param rendered - The rendered badge content to check
 * @returns true if any {{word}} patterns remain after rendering
 *
 * @example
 * ```typescript
 * hasUnsubstitutedPlaceholders("^FDJane Doe^FS")            // → false
 * hasUnsubstitutedPlaceholders("^FD{{visitor_name}}^FS")    // → true
 * ```
 */
export function hasUnsubstitutedPlaceholders(rendered: string): boolean {
  return new RegExp(PLACEHOLDER_REGEX.source).test(rendered);
}
