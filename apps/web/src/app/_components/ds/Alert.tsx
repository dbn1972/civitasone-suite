import type { HTMLAttributes, ReactNode } from "react";

export type AlertVariant = "info" | "success" | "warning" | "danger" | "neutral";

export type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "role" | "children"> & {
  variant?: AlertVariant;
  /** Short bold heading above the body. */
  title?: ReactNode;
  children?: ReactNode;
  /** Trailing action slot (Retry button, link). Rendered after the body. */
  action?: ReactNode;
  /** When set, a dismiss button is rendered and calls this on click. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /**
   * Live-region role. Defaults to `alert` for `danger` and `status` for every
   * other variant. Override only to preserve an existing contract (for example
   * a warning that interrupts the user).
   */
  role?: "alert" | "status" | "note";
};

/**
 * Shared inline banner / notice / callout (SF-13). Colours come only from the
 * theme tokens in civitas-ds.css (--infobg / --goodbg / --warnbg / --badbg and
 * their -bd and text counterparts), each redefined under `.dark`, so the box
 * follows the theme with no per-page hex.
 */
const TONE: Record<AlertVariant, { bg: string; bd: string; fg: string }> = {
  info: { bg: "var(--infobg)", bd: "var(--infobd)", fg: "var(--info)" },
  success: { bg: "var(--goodbg)", bd: "var(--goodbd)", fg: "var(--good)" },
  warning: { bg: "var(--warnbg)", bd: "var(--warnbd)", fg: "var(--warn)" },
  danger: { bg: "var(--badbg)", bd: "var(--badbd)", fg: "var(--bad)" },
  neutral: { bg: "var(--panel)", bd: "var(--line)", fg: "var(--ink2)" },
};

export function Alert({
  variant = "info",
  title,
  children,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  role,
  style,
  className,
  ...rest
}: AlertProps) {
  const tone = TONE[variant];
  const resolvedRole = role ?? (variant === "danger" ? "alert" : "status");
  return (
    <div
      {...rest}
      role={resolvedRole}
      data-variant={variant}
      className={["banner", className].filter(Boolean).join(" ")}
      style={{
        display: "flex",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 12,
        padding: 12,
        marginBottom: 16,
        borderRadius: 12,
        fontSize: 13,
        color: "var(--ink)",
        background: tone.bg,
        border: `1px solid ${tone.bd}`,
        borderLeft: `4px solid ${tone.fg}`,
        ...style,
      }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        {title ? <strong style={{ display: "block", marginBottom: 2, color: tone.fg }}>{title}</strong> : null}
        {children}
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          style={{ flexShrink: 0, background: "none", border: 0, cursor: "pointer", color: "inherit", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
