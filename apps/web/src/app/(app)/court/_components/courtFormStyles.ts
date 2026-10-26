import type React from "react";

/** Form styles shared by the court order/hearing action dialogs and their consoles. */
export const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  width: "100%",
  minHeight: 40,
};
export const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
export const errStyle: React.CSSProperties = { color: "var(--bad)", fontSize: 12, margin: "4px 0 0" };
