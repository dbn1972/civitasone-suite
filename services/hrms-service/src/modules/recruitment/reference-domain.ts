/**
 * Candidate reservation attributes + references + relationship declarations (pure)
 * — R-RA-0082 (reservation attributes with supporting documents) and R-RA-0083
 * (two references + prior interview/employment relationship declarations). No I/O.
 */

export const RESERVED_CATEGORIES = ["SC", "ST", "OBC", "EWS"] as const;
export const ALL_CATEGORIES = ["GEN", "UR", "SC", "ST", "OBC", "EWS"] as const;
export const DISABILITY_TYPES = ["locomotor", "visual", "hearing", "speech", "intellectual", "multiple", "other"] as const;

export interface ReservationAttributes {
  category?: string | null;      // GEN/UR/SC/ST/OBC/EWS
  disability?: boolean;
  disabilityType?: string | null;
  disabilityPercentage?: number | null;
  exServiceman?: boolean;
  freedomFighterDependent?: boolean;
  reservationDocs?: string[];    // uploaded certificate references
}

/**
 * A reserved-category claim needs a supporting certificate; a disability claim
 * needs a type and a percentage (1..100). Ex-serviceman / freedom-fighter claims
 * also require a document.
 */
export function validateReservationAttributes(a: ReservationAttributes): string[] {
  const errors: string[] = [];
  const docs = a.reservationDocs ?? [];
  const cat = (a.category || "").trim().toUpperCase();

  // Reject a garbage category rather than silently storing it in a compliance column.
  if (cat !== "" && !(ALL_CATEGORIES as readonly string[]).includes(cat)) errors.push(`unknown category "${a.category}"`);
  if ((RESERVED_CATEGORIES as readonly string[]).includes(cat) && docs.length === 0) {
    errors.push(`a ${cat} reservation claim requires a supporting certificate`);
  }
  if (a.disability) {
    if (!a.disabilityType || !(DISABILITY_TYPES as readonly string[]).includes(a.disabilityType)) errors.push("a disability claim requires a valid disability type");
    if (a.disabilityPercentage == null || !Number.isInteger(a.disabilityPercentage) || a.disabilityPercentage < 1 || a.disabilityPercentage > 100) errors.push("a disability claim requires a percentage between 1 and 100");
    if (docs.length === 0) errors.push("a disability claim requires a supporting certificate");
  }
  if ((a.exServiceman || a.freedomFighterDependent) && docs.length === 0) {
    errors.push("an ex-serviceman / freedom-fighter claim requires a supporting document");
  }
  return errors;
}

export interface Reference {
  name: string;
  relationship: string;          // e.g. former manager, professor, colleague
  organisation?: string | null;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  yearsKnown?: number | null;
}

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();
const phoneKey = (s: string | null | undefined) => (s || "").replace(/\D/g, "").slice(-10);

/**
 * At least two references, each with a name, a stated relationship and at least one
 * contact channel; no two references may be the same person (by email or phone),
 * and a reference must not be the candidate themselves.
 * NOTE: duplicate detection is per-channel — two entries for the same real person
 * that use DIFFERENT channels (one email, one phone) cannot be reconciled here and
 * are surfaced to HR review, not auto-rejected.
 */
export function validateReferences(refs: readonly Reference[], candidate?: { email?: string | null; phone?: string | null }): string[] {
  const errors: string[] = [];
  if (refs.length < 2) errors.push("at least two references are required");

  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();
  const candEmail = norm(candidate?.email);
  const candPhone = phoneKey(candidate?.phone);

  refs.forEach((r, i) => {
    const label = r.name?.trim() || `reference ${i + 1}`;
    if (!r.name || r.name.trim() === "") errors.push(`reference ${i + 1}: name is required`);
    if (!r.relationship || r.relationship.trim() === "") errors.push(`${label}: relationship is required`);
    const e = norm(r.email);
    const p = phoneKey(r.phone);
    if (!e && !p) errors.push(`${label}: an email or phone is required`);
    if (e && candEmail && e === candEmail) errors.push(`${label}: a reference cannot be the candidate`);
    if (p && candPhone && p === candPhone) errors.push(`${label}: a reference cannot be the candidate`);
    if (e) { if (seenEmail.has(e)) errors.push(`${label}: duplicate reference email`); else seenEmail.add(e); }
    if (p) { if (seenPhone.has(p)) errors.push(`${label}: duplicate reference phone`); else seenPhone.add(p); }
  });
  return errors;
}

export interface RelationshipDeclaration {
  hasPriorRelationship: boolean;
  relations?: Array<{ personName: string; nature: string }>;
}

/**
 * If the candidate declares a prior interview/employment relationship, they must
 * name at least one person and the nature of the relationship (feeds COI review).
 */
export function validateRelationshipDeclaration(d: RelationshipDeclaration): string[] {
  const errors: string[] = [];
  if (d.hasPriorRelationship) {
    const rel = d.relations ?? [];
    if (rel.length === 0) errors.push("declared a prior relationship but named no one");
    rel.forEach((r, i) => {
      if (!r.personName || r.personName.trim() === "") errors.push(`relationship ${i + 1}: person name is required`);
      if (!r.nature || r.nature.trim() === "") errors.push(`relationship ${i + 1}: nature of the relationship is required`);
    });
  }
  return errors;
}
