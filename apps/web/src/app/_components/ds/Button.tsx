import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "default" | "sm";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Marks the button busy: disables it (matching this app's existing
   * disabled-while-busy convention -- see e.g. `disabled={saving}` /
   * `disabled={submitting}` throughout hr/) and sets aria-busy. Does not
   * render a spinner: no raw button being consolidated here shows one
   * today, so adding one would be a visual change beyond this gap's scope.
   * Callers that swap in a "Saving…" label can keep doing that via
   * `children`.
   */
  loading?: boolean;
  children: ReactNode;
};

/**
 * Shared text button for the `.btn` design-system convention defined in
 * civitas-ds.css (`.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`,
 * `.btn.sm`). Renders the exact same classes as the raw
 * `<button className="btn primary">`-style markup used across the app, so
 * swapping to this component is a no-visual-diff refactor wherever that
 * convention was already followed correctly.
 *
 * Not for:
 *  - icon-only buttons -- those use the separate, already-consistent
 *    `.iconbtn` class (see civitas-ds.css); this component always renders
 *    visible text/label children sized for the `.btn` box model.
 *  - irreversible confirm-gated actions (approve/reject/delete/sign) --
 *    use `ActionButton`, which wraps a maker-checker ConfirmDialog and
 *    itself renders one of these `.btn` classes underneath.
 *
 * `variant="secondary"` reproduces existing `btn secondary` markup as-is;
 * civitas-ds.css previously had no `.btn.secondary` rule (a pre-existing gap,
 * not introduced by this component) -- fixed alongside the tranche 2
 * conversions that surfaced it again.
 *
 * Forwards `ref` to the underlying `<button>` element (needed by callers
 * that manage focus imperatively, e.g. focusing a dialog's close button on
 * open per WCAG 2.4.3) -- added in tranche 2 when a real conversion turned
 * out to depend on it; behavior-preserving for every existing caller, none
 * of which pass a ref today.
 *
 * Accepts a caller-supplied `aria-busy` independently of `loading` --
 * added in tranche 3 when a real conversion (`WFHRequestForm`) needed
 * `disabled` and `aria-busy` driven by two different conditions (a
 * broader "submit blocked" check vs. the narrower "currently submitting"
 * one). Before this fix any explicit `aria-busy` prop was silently
 * discarded, because the internal `aria-busy={loading || undefined}` was
 * spread after `...rest` and always won. `loading` still takes priority
 * when both are set; behavior-preserving for every existing caller, none
 * of which pass `aria-busy` directly today.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "default",
    loading = false,
    disabled,
    className = "",
    children,
    "aria-busy": ariaBusy,
    ...rest
  },
  ref,
) {
  const classes = ["btn", variant, size === "sm" ? "sm" : null, className || null]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading ? true : ariaBusy}
    >
      {children}
    </button>
  );
});
