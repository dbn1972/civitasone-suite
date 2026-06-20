# Skill — Accessibility (WCAG 2.2 AA)

**When to load:** Any PR touching `apps/web`, `apps/mobile`, or `packages/ui-kit`.

---

## The bar

CivitasOne Suite must meet WCAG 2.2 Level AA for every user-facing surface. This is not negotiable for Govt/PSU customers (procurement requirement) and is the right thing to do regardless.

## Automated checks (in CI — block merge on regression)

- `axe-core` via Playwright on every E2E test
- `eslint-plugin-jsx-a11y` in lint
- Lighthouse a11y score ≥ 95 on key routes
- Color contrast verified via design token contrast suite

Automated tools catch ~40% of issues. The remaining 60% require manual checks below.

## Manual checks per screen

### Keyboard navigation
- Every interactive element reachable via Tab
- Focus order matches visual order
- Focus visible on every focusable element (shadow.focus token)
- No keyboard trap (Esc closes drawers, modals, menus)
- Skip-to-content link at top of every page

### Screen reader
- Test with VoiceOver (macOS / iOS) and NVDA (Windows)
- Page title is meaningful and unique
- Heading order is logical (h1 → h2 → h3, no skipping)
- Landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`) used
- Icon-only buttons have `aria-label`
- Form fields have associated `<label>` (via FormField molecule)
- Errors are announced via `role="alert"` or `aria-live="assertive"`
- Status updates use `aria-live="polite"`
- Decorative images have `alt=""`; meaningful images have descriptive alt
- SVG icons have `role="img"` and `aria-label` or `aria-hidden="true"`

### Color and contrast
- Body text: 4.5:1 minimum against background
- Large text (≥ 18pt / 14pt bold): 3:1
- UI components and graphical objects: 3:1
- Focus indicator contrast: 3:1
- Color never the only conveyor of meaning — also use icon, text, or pattern

### Motion and animation
- Respect `prefers-reduced-motion` — disable parallax, autoplay, decorative motion
- No flashing > 3 times per second (seizure trigger)
- Animations under 5s or stoppable

### Text and reading
- Body text resizable to 200% without loss of function
- Line height ≥ 1.5
- Paragraph spacing ≥ 2× font size
- Letter spacing ≥ 0.12× font size (configurable for dyslexia preset)
- No images of text (except logos)

### Forms
- Labels visible and persistent (not placeholder-as-label)
- Required fields marked with both `required` attribute and visible indicator
- Errors identified clearly: which field, what is wrong, how to fix
- Error summary at top of form on submit failure
- Inputs grouped logically with `<fieldset>` + `<legend>`
- Autocomplete attributes correct (`email`, `current-password`, etc.)

### Tables (data table organism)
- `<caption>` describes table purpose
- `<th scope="col">` and `<th scope="row">` used correctly
- Sort buttons announce current sort state via `aria-sort`
- Row selection checkboxes have labels
- Density toggle preserves keyboard focus

### Modals and drawers
- Focus moves to first focusable element on open
- Focus trapped within while open
- Esc closes
- Focus returns to triggering element on close
- `aria-modal="true"` on the modal element
- `aria-labelledby` points to the title

### Touch targets (mobile)
- Minimum 44 × 44 px (Apple HIG / WCAG 2.2 SC 2.5.8)
- Spacing between targets ≥ 8px

### Cognitive accessibility (WCAG 2.2 additions)
- Consistent navigation (SC 3.2.6)
- Consistent help mechanism in same place across pages
- Authentication should not require puzzles, transcription, or recall unless an alternative is provided
- Reauthentication preserves user data

## Common violations (and fixes)

| Violation | Fix |
|---|---|
| `<div onClick>` instead of `<button>` | Use Button from ui-kit |
| Color-only status (red dot for error) | Add icon + text |
| Placeholder as label | Use FormField with visible label |
| Modal without focus trap | Use Dialog from ui-kit (handles focus) |
| Icon button without aria-label | Add `aria-label` describing action |
| Form errors only at field level | Add error summary Banner at top of form |
| Drag-and-drop without keyboard alternative | Add menu-based alternative (Move up / Move down / Move to...) |
| Custom select without keyboard support | Use Combobox from ui-kit |
| Live region for every API response | Only announce meaningful changes; debounce |

## Linting rules

`apps/web/.eslintrc.json`:
```json
{
  "extends": ["next/core-web-vitals", "plugin:jsx-a11y/recommended"],
  "rules": {
    "jsx-a11y/no-autofocus": "error",
    "jsx-a11y/click-events-have-key-events": "error",
    "jsx-a11y/no-static-element-interactions": "error"
  }
}
```

## When a11y conflicts with design

Accessibility wins. Push back with the designer; reference the relevant WCAG SC. Most "creative" patterns have accessible equivalents — find them.

## Test snippet (Playwright + axe)

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("dashboard has no a11y violations", async ({ page }) => {
  await page.goto("/dashboard");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```
