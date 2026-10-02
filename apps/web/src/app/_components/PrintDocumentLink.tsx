"use client";

/**
 * Opens statutory print HTML in a new tab (browser print-to-PDF). Shared
 * across finance/general-ledger, procurement/orders and hr/payroll --
 * `disabled` is opt-in (defaults to false) so existing callers are
 * unaffected; payroll's salary-slips table passes it to stop an
 * unapproved slip being printed (GAP-PAYROLL-SALARY-SLIPS-05).
 *
 * GAP-PAYROLL-SALARY-SLIPS-DETAIL-07: the 🖨️ emoji used to be hard-coded
 * into the label here (not even going through i18n) -- a screen reader
 * reads it as "printer", and emoji glyph support varies across print
 * drivers/OSes. aria-hidden="true" on a plain Unicode icon span, same
 * pattern as StatCard's own icon prop, instead of baking it into the text.
 */
export function PrintDocumentLink({
  href,
  label = "Print",
  disabled = false,
  disabledReason,
}: {
  href: string;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (disabled) {
    return (
      <span
        className="btn ghost"
        aria-disabled="true"
        title={disabledReason}
        style={{ whiteSpace: "nowrap", opacity: 0.5, cursor: "not-allowed", pointerEvents: "none" }}
      >
        <span aria-hidden="true">🖨️</span> {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="btn ghost"
      style={{ whiteSpace: "nowrap" }}
    >
      <span aria-hidden="true">🖨️</span> {label}
    </a>
  );
}
