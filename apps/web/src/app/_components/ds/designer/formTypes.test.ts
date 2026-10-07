/**
 * GAP-DESIGNER-DETAIL-B2-03: the field palette must not use OS-dependent emoji
 * glyphs for its icons (they render inconsistently across platforms and clash
 * with the design system). Neutral Unicode text symbols are fine.
 */
import { describe, it, expect } from "vitest";
import { FIELD_PALETTE_GROUPS } from "./formTypes";

// Matches emoji codepoints from the Supplementary Multilingual Plane (SMP)
// that are typically rendered as colored images. Characters in the Basic
// Multilingual Plane like ☑, ☰, ✉, ☏ are standard text symbols and fine.
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/u;

describe("field palette icons (GAP-DESIGNER-DETAIL-B2-03)", () => {
  it("contains no emoji glyphs in any palette item icon", () => {
    const offenders: string[] = [];
    for (const group of FIELD_PALETTE_GROUPS) {
      for (const item of group.items) {
        if (EMOJI_RE.test(item.icon)) offenders.push(`${item.type}:${item.icon}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still provides a non-empty icon for every field type", () => {
    for (const group of FIELD_PALETTE_GROUPS) {
      for (const item of group.items) {
        expect(item.icon.length).toBeGreaterThan(0);
      }
    }
  });
});
