/**
 * RequiredLegend -- the "* required" legend at the top of every form that uses the form-field standard
 * (UX-R5, GLB-13). One convention: a red asterisk after the label means required; this line says so once.
 * Wording comes from recordUi (`legend`, `legendOptional`) so it follows the officer's language.
 */
import { useTranslations } from "next-intl";
import { formRequiredMarkStyle } from "./_formControlStyle";

export function RequiredLegend({ optionalNote }: { optionalNote?: boolean }) {
  const t = useTranslations("recordUi");
  return (
    <p data-required-legend="" style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--ink2)" }}>
      {t.rich("legend", {
        mark: () => <span aria-hidden="true" style={formRequiredMarkStyle}>*</span>,
        sr: (chunks) => <span className="sr-only">{chunks}</span>,
      })}
      {optionalNote ? ` ${t("legendOptional")}` : null}
    </p>
  );
}
