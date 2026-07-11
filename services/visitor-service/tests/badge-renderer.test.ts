/**
 * Unit tests for badge-print renderer module.
 *
 * Tests cover: SUPPORTED_PLACEHOLDERS constant, validateTemplatePlaceholders,
 * renderBadge, and hasUnsubstitutedPlaceholders.
 */
import { describe, it, expect } from "vitest";
import {
  SUPPORTED_PLACEHOLDERS,
  PlaceholderKey,
  validateTemplatePlaceholders,
  renderBadge,
  hasUnsubstitutedPlaceholders,
} from "../src/modules/badge-print/renderer.js";

// ---------------------------------------------------------------------------
// SUPPORTED_PLACEHOLDERS constant
// ---------------------------------------------------------------------------

describe("SUPPORTED_PLACEHOLDERS", () => {
  it("contains exactly 12 placeholders", () => {
    expect(SUPPORTED_PLACEHOLDERS).toHaveLength(12);
  });

  it("includes all expected placeholder names", () => {
    const expected = [
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
    ];
    expect([...SUPPORTED_PLACEHOLDERS]).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// validateTemplatePlaceholders
// ---------------------------------------------------------------------------

describe("validateTemplatePlaceholders", () => {
  it("returns valid: true for a template with only supported placeholders", () => {
    const template = "Name: {{visitor_name}}, Host: {{host_name}}";
    const result = validateTemplatePlaceholders(template);
    expect(result.valid).toBe(true);
    expect(result.invalidPlaceholders).toEqual([]);
  });

  it("returns valid: true for a template with no placeholders", () => {
    const template = "^XA^FO50,50^FDStatic Text^FS^XZ";
    const result = validateTemplatePlaceholders(template);
    expect(result.valid).toBe(true);
    expect(result.invalidPlaceholders).toEqual([]);
  });

  it("returns valid: false for a template with unsupported placeholders", () => {
    const template = "{{visitor_name}} from {{unknown_field}}";
    const result = validateTemplatePlaceholders(template);
    expect(result.valid).toBe(false);
    expect(result.invalidPlaceholders).toEqual(["unknown_field"]);
  });

  it("returns all invalid placeholders when multiple are unsupported", () => {
    const template = "{{foo}} {{visitor_name}} {{bar}} {{baz}}";
    const result = validateTemplatePlaceholders(template);
    expect(result.valid).toBe(false);
    expect(result.invalidPlaceholders).toEqual(["foo", "bar", "baz"]);
  });

  it("does not report duplicates for repeated invalid placeholders", () => {
    const template = "{{bad}} {{bad}} {{bad}}";
    const result = validateTemplatePlaceholders(template);
    expect(result.valid).toBe(false);
    expect(result.invalidPlaceholders).toEqual(["bad"]);
  });

  it("validates all 12 supported placeholders as valid", () => {
    const template = SUPPORTED_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ");
    const result = validateTemplatePlaceholders(template);
    expect(result.valid).toBe(true);
    expect(result.invalidPlaceholders).toEqual([]);
  });

  it("handles empty string template", () => {
    const result = validateTemplatePlaceholders("");
    expect(result.valid).toBe(true);
    expect(result.invalidPlaceholders).toEqual([]);
  });

  it("does not match partial brace patterns like {visitor_name} or {{visitor_name}", () => {
    const template = "{visitor_name} {{visitor_name}";
    const result = validateTemplatePlaceholders(template);
    expect(result.valid).toBe(true);
    expect(result.invalidPlaceholders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderBadge
// ---------------------------------------------------------------------------

describe("renderBadge", () => {
  it("substitutes all placeholders with provided data", () => {
    const template = "^FD{{visitor_name}}^FS ^FD{{host_name}}^FS";
    const data: Partial<Record<PlaceholderKey, string>> = {
      visitor_name: "Jane Doe",
      host_name: "John Smith",
    };
    const result = renderBadge(template, data);
    expect(result).toBe("^FDJane Doe^FS ^FDJohn Smith^FS");
  });

  it("replaces missing data values with empty string", () => {
    const template = "Name: {{visitor_name}}, Dept: {{host_department}}";
    const data: Partial<Record<PlaceholderKey, string>> = {
      visitor_name: "Alice",
    };
    const result = renderBadge(template, data);
    expect(result).toBe("Name: Alice, Dept: ");
  });

  it("handles template with no placeholders", () => {
    const template = "^XA^FDStatic^FS^XZ";
    const result = renderBadge(template, {});
    expect(result).toBe("^XA^FDStatic^FS^XZ");
  });

  it("handles multiple occurrences of the same placeholder", () => {
    const template = "{{visitor_name}} - {{visitor_name}}";
    const data: Partial<Record<PlaceholderKey, string>> = {
      visitor_name: "Bob",
    };
    const result = renderBadge(template, data);
    expect(result).toBe("Bob - Bob");
  });

  it("substitutes all 12 supported placeholders", () => {
    const template = SUPPORTED_PLACEHOLDERS.map((p) => `{{${p}}}`).join("|");
    const data: Partial<Record<PlaceholderKey, string>> = {};
    for (const p of SUPPORTED_PLACEHOLDERS) {
      data[p] = `value_${p}`;
    }
    const result = renderBadge(template, data);
    const expected = SUPPORTED_PLACEHOLDERS.map((p) => `value_${p}`).join("|");
    expect(result).toBe(expected);
  });

  it("replaces unsupported placeholders with empty string (graceful)", () => {
    // Even if an unsupported placeholder is in the template, renderBadge
    // will attempt substitution via the data record; if not found, defaults to ""
    const template = "{{visitor_name}} {{unknown_key}}";
    const data: Partial<Record<PlaceholderKey, string>> = {
      visitor_name: "Test",
    };
    const result = renderBadge(template, data);
    expect(result).toBe("Test ");
  });

  it("preserves special characters in data values", () => {
    const template = "{{visitor_name}}";
    const data: Partial<Record<PlaceholderKey, string>> = {
      visitor_name: "Héctor O'Brien & Co. <div>",
    };
    const result = renderBadge(template, data);
    expect(result).toBe("Héctor O'Brien & Co. <div>");
  });
});

// ---------------------------------------------------------------------------
// hasUnsubstitutedPlaceholders
// ---------------------------------------------------------------------------

describe("hasUnsubstitutedPlaceholders", () => {
  it("returns false for fully rendered output with no placeholders", () => {
    expect(hasUnsubstitutedPlaceholders("^FDJane Doe^FS")).toBe(false);
  });

  it("returns true when a placeholder pattern remains", () => {
    expect(hasUnsubstitutedPlaceholders("^FD{{visitor_name}}^FS")).toBe(true);
  });

  it("returns true for any word pattern in double braces", () => {
    expect(hasUnsubstitutedPlaceholders("Something {{random_key}} here")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasUnsubstitutedPlaceholders("")).toBe(false);
  });

  it("returns false for single braces (not placeholder syntax)", () => {
    expect(hasUnsubstitutedPlaceholders("{not_a_placeholder}")).toBe(false);
  });

  it("returns false for braces with non-word characters", () => {
    expect(hasUnsubstitutedPlaceholders("{{not-valid}}")).toBe(false);
    expect(hasUnsubstitutedPlaceholders("{{has spaces}}")).toBe(false);
  });
});
