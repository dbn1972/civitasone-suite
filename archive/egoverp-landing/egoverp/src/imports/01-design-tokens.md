# Foundation — Design Tokens

**SCREEN TYPE:** Design system foundation (not a user-facing screen)
**SPRINT:** 1 (must exist before any other prompt is used)

---

## Figma Make prompt

```
Generate a Design Tokens documentation page for the CivitasOne Suite design system.

PRODUCT: CivitasOne Suite — Unified Enterprise Suite (Govt, PSU, Small Office)

Render every token category as a visual swatch / spec sheet, grouped under headings:

1. COLOR — SEMANTIC (light + dark variants side by side)
   - surface.canvas, surface.raised, surface.sunken
   - text.primary, text.secondary, text.muted, text.inverse
   - border.subtle, border.default, border.strong
   - intent.success, intent.warning, intent.danger, intent.info, intent.primary
   Each swatch shows: token name, hex value (light), hex value (dark), contrast ratio against surface.canvas

2. COLOR — BRAND (tenant-overridable at runtime)
   - brand.primary, brand.secondary, brand.accent
   Show example of a tenant override (different brand color applied to same component)

3. TYPOGRAPHY
   - font.sans (Inter), font.mono (JetBrains Mono)
   - Scale: display (40/48), h1 (32/40), h2 (24/32), h3 (20/28), h4 (18/24),
            body (16/24), body-sm (14/20), caption (12/16), code (14/20)
   Render each style with the sample sentence "CivitasOne Suite delivers governance at scale."

4. SPACING (4px scale)
   - space.1 (4), space.2 (8), space.3 (12), space.4 (16), space.5 (20),
     space.6 (24), space.8 (32), space.10 (40), space.12 (48), space.16 (64)
   Visualise each as a colored bar with the value labeled.

5. RADIUS
   - radius.sm (4), radius.md (8), radius.lg (12), radius.pill (9999)
   Show a card sample at each radius.

6. SHADOW (elevation)
   - shadow.sm, shadow.md, shadow.lg, shadow.focus (outline-style for focus rings)
   Show a card with each shadow on surface.canvas.

7. MOTION
   - motion.fast (120ms), motion.base (200ms), motion.slow (320ms)
   - easing.standard (cubic-bezier(0.2, 0, 0, 1))
   Show three animated examples (fade, slide, scale) at each duration.

8. DENSITY
   - density.comfortable (default — 16px row height padding)
   - density.compact (Govt edition default — 8px row height padding)
   Show the same DataTable in both densities side by side.

LAYOUT:
- A single long Figma frame, sections separated by 64px space.16 dividers
- Heading per section uses text.h2 token
- Each swatch / sample annotated with the EXACT token name in mono font

CONSTRAINTS:
- WCAG 2.2 AA contrast minimums enforced — every semantic color pair shows its contrast ratio
- Dark mode rendered side-by-side, never as a separate file
- No decorative color outside the token set
- All numbers in pixels (not rem) on the Figma surface — tokens themselves use rem in code

OUT OF SCOPE:
- Brand identity work (logo, mascot, illustration)
- Marketing color usage guidance
```

---

## After generation

1. Export each token group as a JSON snippet matching the structure in `packages/ui-kit/tokens/`
2. Sync to Figma Variables via Figma Tokens plugin
3. Tag the Figma file as "Foundation v0.1.0 — Design Tokens"
4. Open PR against `packages/ui-kit/tokens/` with the exported JSON
