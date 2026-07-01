/** Structured referencing domain — pure (R7). */

export const REFERENCE_TYPES = [
  "puc", "rule", "precedent_file", "concurrence", "legal_opinion", "annexure", "cross_file",
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export function isReferenceType(v: string): v is ReferenceType {
  return (REFERENCE_TYPES as readonly string[]).includes(v);
}
