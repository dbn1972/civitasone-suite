/**
 * GAP-CRM-RTI-05: the register subtitle lived as two slightly different string
 * literals — one on the page ("…30-day statutory response register.") and one
 * on the loading skeleton ("…30-day response register.") — so the heading
 * flickered to a different wording while loading. Share the one canonical
 * string here so the loaded and loading views can never disagree.
 */
export const RTI_SUBTITLE =
  "Right to Information Act 2005 — 30-day statutory response register.";
