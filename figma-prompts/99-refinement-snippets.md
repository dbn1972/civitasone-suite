# Refinement Snippets — Figma Make

After your initial Figma Make generation, use these one-liners to iterate without restarting from scratch. Paste them as follow-up prompts.

---

## Token & component compliance

```
- Replace every hex color literal with the closest semantic token from packages/ui-kit/tokens/color.json. Flag any color that has no matching token.
- Swap every component that is not in the CivitasOne UI Kit for the closest ui-kit equivalent. Annotate any missing component as "MISSING: <ComponentName>" so we can add it to the kit.
- Replace every font-size pixel value with the nearest typography token (text.display, text.h1..h4, text.body, text.body-sm, text.caption, text.code).
- Replace every spacing value with the nearest space.* token from the 4px scale.
- Replace every border-radius with radius.sm | md | lg | pill.
- Replace every shadow with shadow.sm | md | lg | focus.
```

## States

```
- Add the empty, loading, error, and success states beside the default state on the same frame.
- Add a dark mode variant of every frame to the right of its light counterpart.
- Add an RTL (Arabic) variant of every frame below the existing variants.
- Add the density.compact variant of this list / table beside the default density.comfortable.
- Add a permission-denied state showing what a user without access would see on this route.
```

## Responsive

```
- Generate the mobile (375px) version of this screen with the layout collapsed to a single column. Filters collapse into a bottom drawer.
- Generate the tablet (768px) version of this screen.
- Show how the sticky save bar behaves when the keyboard is open on mobile.
```

## Accessibility

```
- Add focus rings (using shadow.focus token) to every interactive element.
- Annotate each interactive element with its ARIA label and role as a Figma comment beside the element.
- Indicate keyboard tab order with numbered annotations.
- Verify that all text on a colored background meets WCAG 2.2 AA contrast (4.5:1 for body, 3:1 for large text and UI). Mark any that fail.
- Add a live-region annotation to any zone that announces dynamic changes (toasts, validation, countdowns).
```

## Theming

```
- Show the same screen with the tenant brand color overridden to a high-contrast accessible alternative (e.g. green / purple) to prove tokens cascade.
- Render the dark-mode variant assuming a high-contrast dark profile.
- Apply the Govt Department default density (compact) to this screen.
```

## Data realism

```
- Replace lorem-ipsum text with realistic data appropriate to the module (Indian names, INR amounts, IST timestamps, real account codes for Govt IGAS).
- Show this screen at three data scales: 0 rows (empty), 12 rows (default), 200+ rows (with pagination engaged).
```

## Edge cases

```
- Show what this screen looks like when the user has no permission to one of the primary actions (action disabled with tooltip explaining why).
- Show this screen during a system maintenance window — Banner at top with countdown.
- Show this screen when one of the dependent services is degraded (partial loading).
- Show this screen during a tenant suspension — limited read-only view.
```

## Annotations

```
- Annotate each region with: component name, ui-kit reference, props used.
- Annotate each form field with: validation rule, error message, required indicator.
- Annotate each primary action with: API endpoint called, success behavior, failure behavior.
- Annotate each state with: trigger condition and exit condition.
```

## Export prep

```
- Group all variants of this screen into a single Figma frame group named "{screen-name}" for easy export.
- Add a cover frame at the top with: screen name, route, sprint, primary role, linked GitHub issue, last updated date.
- Tag the frame with the module label and edition labels.
```
