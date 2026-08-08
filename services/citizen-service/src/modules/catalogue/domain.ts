/**
 * SVC-081 — pure catalogue domain helpers (no I/O, unit-tested).
 *
 * A government service catalogue entry is a VERSIONED, immutable-once-published
 * service definition: per service → owner, linked eligibility rule-set (083),
 * required-documents checklist, linked fee schedule (085), issuance type (086),
 * SLA, channels, forms and outputs. Publishing freezes a version; a revision is
 * a NEW row at version+1 in 'draft'.
 */

/** FN-24 — portal, mobile, CSC/counter, assisted, WhatsApp handoff, API. */
export const SERVICE_CHANNELS = ["portal", "counter", "mobile", "assisted", "whatsapp", "api"] as const;
export type ServiceChannel = typeof SERVICE_CHANNELS[number];

/** Universal Service Designer — four workflow shapes (FN-01). */
export const SERVICE_PATTERNS = ["certificate", "booking", "collection", "grievance"] as const;
export type ServicePattern = typeof SERVICE_PATTERNS[number];

export const FEE_MODELS = ["flat", "slab", "engine"] as const;
export type FeeModel = typeof FEE_MODELS[number];

export interface RequiredDocument {
  docType: string;
  label?: string | undefined;
  mandatory: boolean;
}

export const CATALOGUE_STATUSES = ["draft", "published", "archived"] as const;
export type CatalogueStatus = typeof CATALOGUE_STATUSES[number];

/**
 * Structural validation before publish. A published definition is immutable
 * forever, so it MUST be well-formed: a name, at least one channel, and a
 * checklist with unique, non-empty docTypes.
 */
export function assertDefinitionPublishable(def: {
  name: string;
  channels: ServiceChannel[];
  requiredDocuments: RequiredDocument[];
}): void {
  if (typeof def.name !== "string" || def.name.trim().length === 0) throw new Error("DEF_MISSING_NAME");
  if (!Array.isArray(def.channels) || def.channels.length === 0) throw new Error("DEF_NO_CHANNELS");
  for (const ch of def.channels) {
    if (!SERVICE_CHANNELS.includes(ch)) throw new Error(`DEF_BAD_CHANNEL: ${ch}`);
  }
  const seen = new Set<string>();
  for (const d of def.requiredDocuments) {
    if (!d || typeof d.docType !== "string" || d.docType.length === 0) throw new Error("DEF_BAD_DOCUMENT");
    if (seen.has(d.docType)) throw new Error(`DEF_DUPLICATE_DOCUMENT: ${d.docType}`);
    seen.add(d.docType);
  }
}

/** The mandatory docType checklist a citizen must provide for this definition. */
export function mandatoryDocTypes(requiredDocuments: RequiredDocument[]): string[] {
  return requiredDocuments.filter((d) => d.mandatory).map((d) => d.docType);
}
