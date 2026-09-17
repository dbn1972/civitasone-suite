"use client";

import { Button, type ButtonVariant } from "./ds";

/**
 * PlaceholderButton — a wrapper for action buttons that are not yet
 * connected to a backend endpoint. Renders as an honest, clearly-disabled
 * "coming soon" control — the same disabled-button convention already used
 * elsewhere in this app (see estab/meetings/[id]/MeetingActions.tsx and
 * estab/meetings/page.tsx: `disabled` + `aria-disabled="true"` + a `title`
 * tooltip + a visible "(coming soon)" tag) — rather than firing a
 * window.alert() popup on click (UX-009).
 *
 * Use this in server-component pages where a button placeholder is needed
 * but the backend action is not yet implemented.
 *
 * UX-008 tranche 9: renders through the shared `Button`, so the visual style
 * is now selected via the typed `variant` prop instead of a raw `className`
 * string (the only real caller passing a non-default value, tenant-admin's
 * "Invite user", updated from `className="btn primary"` to `variant="primary"`).
 */
export function PlaceholderButton({
  label,
  variant = "ghost",
  style,
  "aria-label": ariaLabel,
}: {
  label: string;
  variant?: ButtonVariant;
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  return (
    <Button
      variant={variant}
      style={style}
      disabled
      aria-disabled="true"
      aria-label={ariaLabel}
      title={`"${label}" is not yet available. This feature is coming soon.`}
    >
      {label}{" "}
      <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>(coming soon)</span>
    </Button>
  );
}
