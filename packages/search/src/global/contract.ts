/**
 * The indexing contract: the ONLY shape a module may hand to global search. Deliberately small and closed:
 * an identifier, a display title, a business number, a status and an optional non-personal one-line summary.
 * There is no free-form `metadata` bag, so salary, PAN, bank, Aadhaar, address etc. cannot be passed by accident;
 * whatever a producer puts in the permitted strings is additionally scrubbed by pii.ts.
 */
import { GLOBAL_ENTITY_TYPES, isGlobalEntityType, type GlobalEntityType } from "./catalogue.js";
import { redactSensitive } from "./pii.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GlobalSearchRecordInput {
  entityType: GlobalEntityType;
  /** Primary key of the record in its owning service. */
  entityId: string;
  tenantId: string;
  /** Display title: voucher no / vendor name / employee name ... */
  title: string;
  /** Business number: bill no, PO no, employee no ... */
  refNumber?: string | undefined;
  status: string;
  /** Optional non-personal one-liner (type, date, department). Never amounts of people or contact details. */
  summary?: string | undefined;
}

/** The document stored in the `global_search` index. */
export interface GlobalSearchDocument {
  id: string;
  tenantId: string;
  module: string;
  entityType: GlobalEntityType;
  entityId: string;
  title: string;
  refNumber: string;
  status: string;
  summary: string;
  indexedAt: string;
}

export class GlobalSearchContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlobalSearchContractError";
  }
}

const MAX = { title: 200, refNumber: 80, status: 40, summary: 200 } as const;

/** Meili document ids allow [A-Za-z0-9_-]; tenant is part of the id so one tenant can never overwrite another's doc. */
export function globalDocId(tenantId: string, entityType: GlobalEntityType, entityId: string): string {
  return `${tenantId}__${entityType.replace(/[^a-z0-9]/gi, "_")}__${entityId}`;
}

function clean(value: string | undefined, max: number): { text: string; redactions: number } {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return redactSensitive(trimmed);
}

export interface BuiltRecord {
  doc: GlobalSearchDocument;
  redactions: number;
}

/** Validate + minimise + scrub a record into an index document. Throws GlobalSearchContractError when invalid. */
export function buildGlobalDocument(input: GlobalSearchRecordInput, now: Date = new Date()): BuiltRecord {
  if (!isGlobalEntityType(input.entityType)) throw new GlobalSearchContractError(`unknown entityType: ${String(input.entityType)}`);
  if (!UUID_RE.test(input.tenantId)) throw new GlobalSearchContractError("tenantId must be a UUID");
  if (!UUID_RE.test(input.entityId)) throw new GlobalSearchContractError("entityId must be a UUID");
  const title = clean(input.title, MAX.title);
  if (!title.text) throw new GlobalSearchContractError("title is required");
  const ref = clean(input.refNumber, MAX.refNumber);
  const status = clean(input.status, MAX.status);
  const summary = clean(input.summary, MAX.summary);
  return {
    redactions: title.redactions + ref.redactions + status.redactions + summary.redactions,
    doc: {
      id: globalDocId(input.tenantId, input.entityType, input.entityId),
      tenantId: input.tenantId,
      module: GLOBAL_ENTITY_TYPES[input.entityType].module,
      entityType: input.entityType,
      entityId: input.entityId,
      title: title.text,
      refNumber: ref.text,
      status: status.text || "unknown",
      summary: summary.text,
      indexedAt: now.toISOString(),
    },
  };
}
