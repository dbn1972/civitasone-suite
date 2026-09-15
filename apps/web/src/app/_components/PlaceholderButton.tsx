"use client";

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
 */
export function PlaceholderButton({
  label,
  className = "btn ghost",
  style,
  "aria-label": ariaLabel,
}: {
  label: string;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled
      aria-disabled="true"
      aria-label={ariaLabel}
      title={`"${label}" is not yet available. This feature is coming soon.`}
    >
      {label}{" "}
      <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>(coming soon)</span>
    </button>
  );
}
