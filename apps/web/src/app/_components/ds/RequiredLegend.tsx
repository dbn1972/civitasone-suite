/**
 * RequiredLegend -- the "* required" legend at the top of every form that uses the form-field standard
 * (UX-R5, GLB-13). One convention: a red asterisk after the label means required; this line says so once.
 */
import { formRequiredMarkStyle } from "./_formControlStyle";

export function RequiredLegend({ optionalNote }: { optionalNote?: boolean }) {
  return (
    <p data-required-legend="" style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--ink2)" }}>
      Fields marked <span aria-hidden="true" style={formRequiredMarkStyle}>*</span>
      <span className="sr-only"> with an asterisk</span> are required.
      {optionalNote ? " Other fields are optional." : null}
    </p>
  );
}
