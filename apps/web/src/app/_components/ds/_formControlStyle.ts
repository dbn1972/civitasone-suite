/**
 * Shared inline-style tokens for Field/Input/Select/Textarea.
 *
 * Not exported from `./index` -- this is internal plumbing (same
 * `_`-prefix-means-not-a-route convention this app already uses for
 * `_components` / `_data` directories), consumed only by the form
 * primitives in this directory.
 *
 * Deliberately plain inline styles, not new civitas-ds.css classes: every
 * hand-rolled hr/ form already styles its label/input this exact way via
 * local `inputStyle`/`labelStyle` objects (see e.g.
 * hr/departments/new/AddDepartmentForm.tsx before its Button conversion),
 * so matching that convention here makes adopting these primitives a
 * no-visual-diff swap. civitas-ds.css does have a `.field` class already,
 * but it means something else entirely (a read-only label/value display
 * pair, see the `.field .lbl` / `.field .val` rules) -- reusing that name
 * for this form-field primitive would collide with it, hence the inline
 * styles instead of a new `.field`/`.input` class pair.
 */

export const formLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--ink, #0f172a)",
};

export const formControlStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 10,
  background: "var(--panel, #fff)",
  color: "var(--ink, #0f172a)",
  minHeight: 44,
};

export const formErrorStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--bad, #b91c1c)",
};

export const formRequiredMarkStyle: React.CSSProperties = {
  color: "var(--bad, #b91c1c)",
};
