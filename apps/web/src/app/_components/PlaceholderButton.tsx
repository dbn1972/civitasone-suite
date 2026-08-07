"use client";

/**
 * PlaceholderButton — a client component wrapper for action buttons that
 * are not yet connected to a backend endpoint. Shows an alert indicating
 * the feature is coming soon.
 *
 * Use this in server-component pages where a button must be interactive
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
  function handleClick() {
    window.alert(`"${label}" is not yet available. This feature is coming soon.`);
  }

  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={handleClick}
      aria-label={ariaLabel}
    >
      {label}
    </button>
  );
}
