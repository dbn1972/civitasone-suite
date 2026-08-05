/**
 * Document & Attachment Management client (BRD §7.12, DM-001..DM-003).
 *
 * Every call to OUR API routes through the BFF proxy via browserFetch (httpOnly
 * session + device headers). The ONE exception is the direct S3 presigned PUT of
 * the file bytes (uploadToStorage) — that targets the storage provider, not our
 * API, so it uses a plain fetch as the contract requires.
 *
 * Read loaders return { source: "error" } on failure so screens render "—" +
 * DataSourceBadge instead of fabricating an empty list as fact. Normalisers
 * tolerate a bare array OR an { items | data | <named> } wrapper and accept
 * several field-name spellings, because the crm-service documents module is
 * being built concurrently — the UI stays forgiving and any mismatch is
 * reported rather than silently mis-rendered.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type DmSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: DmSource;
}

/* ---------------------------------------------------------------- helpers */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}
function optNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
/** Tolerate bare-array vs { items | data | <named> } wrappers. */
function toArray(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["items", "data", ...keys]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
/** Unwrap a single-object payload from { document } | { data } | bare. */
function unwrap(raw: unknown, ...keys: string[]): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const k of keys) {
      const v = (raw as Record<string, unknown>)[k];
      if (v && typeof v === "object") return v;
    }
  }
  return raw;
}

/* ======================================================= shared constants == */

/** Records a document can hang off (CONTRACT subjectType vocabulary). */
export const SUBJECT_TYPES = ["lead", "contact", "account", "opportunity", "quotation", "case"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const SUBJECT_TYPE_LABELS: Record<SubjectType, string> = {
  lead: "Lead",
  contact: "Contact",
  account: "Account",
  opportunity: "Opportunity",
  quotation: "Quotation",
  case: "Case",
};

/** Malware-scan lifecycle for an uploaded file. */
export const SCAN_STATUSES = ["pending", "clean", "infected", "error"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  pending: "Scan pending",
  clean: "Clean",
  infected: "Infected",
  error: "Scan error",
};

/** Verification lifecycle (DM-002). */
export const VERIFICATION_STATUSES = ["unverified", "verified", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: "Not verified",
  verified: "Verified",
  rejected: "Rejected",
};

/** Where the bytes actually live (DM-003). */
export const STORAGE_PROVIDERS = ["s3", "knowledge_dms", "external"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const STORAGE_PROVIDER_LABELS: Record<StorageProvider, string> = {
  s3: "Secure storage",
  knowledge_dms: "Stored in DMS",
  external: "External store",
};

/** True when the file is quarantined and must never be offered for download. */
export function isInfected(d: Pick<Document, "scanStatus">): boolean {
  return d.scanStatus === "infected";
}
/**
 * True when a download may be offered. ONLY a clean scan verdict qualifies: a
 * file that is still "pending", errored, or infected must never present a
 * working download control (the backend download endpoint refuses non-clean too
 * — this is the matching front-end guard).
 */
export function isDownloadable(d: Pick<Document, "scanStatus">): boolean {
  return d.scanStatus === "clean";
}

/* ============================================================ DM-001 types == */

export interface Document {
  id: string;
  subjectType: SubjectType | string;
  subjectId: string;
  docType?: string;
  title: string;
  filename: string;
  version: number;
  isCurrent: boolean;
  scanStatus: ScanStatus;
  verificationStatus: VerificationStatus;
  expiryDate?: string;
  storageProvider: StorageProvider;
  mimeType?: string;
  sizeBytes?: number;
  supersedesId?: string;
  createdAt?: string;
}

function normScan(v: unknown): ScanStatus {
  const s = str(v);
  return (SCAN_STATUSES as readonly string[]).includes(s) ? (s as ScanStatus) : "pending";
}
function normVerification(v: unknown): VerificationStatus {
  const s = str(v);
  if ((VERIFICATION_STATUSES as readonly string[]).includes(s)) return s as VerificationStatus;
  // tolerate a bare boolean `verified` flag
  return "unverified";
}
function normProvider(v: unknown): StorageProvider {
  const s = str(v);
  return (STORAGE_PROVIDERS as readonly string[]).includes(s) ? (s as StorageProvider) : "s3";
}

export function normaliseDocument(raw: unknown): Document | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id ?? r.documentId ?? r._id);
  if (!id) return null;
  const verifiedFlag = r.verificationStatus ?? (r.verified === true ? "verified" : undefined);
  return {
    id,
    subjectType: str(r.subjectType) || str(r.entityType),
    subjectId: str(r.subjectId) || str(r.entityId),
    docType: optStr(r.docType ?? r.documentType ?? r.typeCode),
    title: str(r.title) || str(r.filename) || "Untitled document",
    filename: str(r.filename) || str(r.fileName) || str(r.name),
    version: num(r.version) || 1,
    isCurrent: bool(r.isCurrent ?? r.current, true),
    scanStatus: normScan(r.scanStatus ?? r.scan_status),
    verificationStatus: normVerification(verifiedFlag),
    expiryDate: optStr(r.expiryDate ?? r.expiresAt ?? r.expiry),
    storageProvider: normProvider(r.storageProvider ?? r.provider ?? r.storage),
    mimeType: optStr(r.mimeType ?? r.contentType),
    sizeBytes: optNum(r.sizeBytes ?? r.size),
    supersedesId: optStr(r.supersedesId ?? r.supersedes),
    createdAt: optStr(r.createdAt ?? r.uploadedAt ?? r.created_at),
  };
}

export function normaliseDocuments(raw: unknown): Document[] {
  return toArray(raw, "documents")
    .map(normaliseDocument)
    .filter((d): d is Document => d !== null);
}

/**
 * Group a flat document list into version chains keyed by the current document.
 * A chain = the current doc plus any superseded ancestors, newest version first.
 * Falls back to treating every doc as its own chain when supersedesId is absent.
 */
export interface DocumentChain {
  current: Document;
  versions: Document[];
}

export function buildChains(docs: Document[]): DocumentChain[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const supersededIds = new Set(
    docs.map((d) => d.supersedesId).filter((x): x is string => Boolean(x)),
  );
  // A "head" is a doc no other doc supersedes (or one explicitly marked current).
  const heads = docs.filter((d) => !supersededIds.has(d.id));
  const chains: DocumentChain[] = [];
  for (const head of heads) {
    const versions: Document[] = [head];
    let cursor: Document | undefined = head;
    const guard = new Set<string>([head.id]);
    while (cursor?.supersedesId) {
      const prev: Document | undefined = byId.get(cursor.supersedesId);
      if (!prev || guard.has(prev.id)) break;
      guard.add(prev.id);
      versions.push(prev);
      cursor = prev;
    }
    versions.sort((a, b) => b.version - a.version);
    chains.push({ current: versions[0], versions });
  }
  // Stable: newest chain first by current.version then createdAt.
  chains.sort((a, b) => (b.current.createdAt ?? "").localeCompare(a.current.createdAt ?? ""));
  return chains;
}

export interface PresignResult {
  uploadUrl: string;
  storageKey: string;
}

export interface PresignInput {
  subjectType: SubjectType;
  subjectId: string;
  filename: string;
  mimeType: string;
}

/** DM-001 step 1: ask our API for a presigned PUT URL + storage key. */
export async function presignUpload(input: PresignInput): Promise<PresignResult> {
  const res = await browserFetch("v1/crm/documents/presign", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  const body = (await res.json()) as Record<string, unknown>;
  const uploadUrl = str(body.uploadUrl ?? body.url);
  const storageKey = str(body.storageKey ?? body.key);
  if (!uploadUrl || !storageKey) {
    throw new Error("PRESIGN_INCOMPLETE: the server did not return an upload URL and storage key.");
  }
  return { uploadUrl, storageKey };
}

/**
 * DM-001 step 2: PUT the raw bytes straight to the storage provider. This is the
 * ONE allowed non-browserFetch call — it targets S3 (or a compatible presigned
 * endpoint), never our API, so no session/device headers apply.
 */
export async function uploadToStorage(uploadUrl: string, file: File | Blob, mimeType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "content-type": mimeType },
  });
  if (!res.ok) {
    throw new Error(`STORAGE_UPLOAD_FAILED: the file could not be stored (HTTP ${res.status}).`);
  }
}

export interface ConfirmInput {
  subjectType: SubjectType;
  subjectId: string;
  docType?: string;
  title: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string;
  supersedesId?: string;
}

/** DM-001 step 3: confirm the upload so the API records the document row. */
export async function confirmDocument(input: ConfirmInput): Promise<Document | null> {
  const res = await browserFetch("v1/crm/documents", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  // Some backends return the created row; others return { id } or 202. Tolerate all.
  try {
    const body = await res.json();
    return normaliseDocument(unwrap(body, "document", "data"));
  } catch {
    return null;
  }
}

export async function getDocuments(subjectType: string, subjectId: string): Promise<LoaderResult<Document[]>> {
  try {
    const params = new URLSearchParams({ subjectType, subjectId });
    const res = await browserFetch(`v1/crm/documents?${params.toString()}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseDocuments(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/**
 * DM-001: resolve a presigned GET URL for download. The API returns 403 for an
 * infected file — we surface that honestly and NEVER open a URL for one.
 */
export async function getDownloadUrl(id: string): Promise<string> {
  const res = await browserFetch(`v1/crm/documents/${id}/download`);
  if (res.status === 403) {
    throw new Error("BLOCKED: this file was flagged by the malware scan and cannot be downloaded.");
  }
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  const body = (await res.json()) as Record<string, unknown>;
  const url = str(body.url ?? body.downloadUrl);
  if (!url) throw new Error("DOWNLOAD_URL_MISSING: the server did not return a download link.");
  return url;
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/documents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/* ============================================================ DM-002 types == */

export interface DocumentType {
  id?: string;
  code: string;
  name: string;
  /** Which subject types this document type applies to. */
  appliesTo: SubjectType[];
  mandatory: boolean;
  expiryRequired: boolean;
  verificationRequired: boolean;
  enabled: boolean;
}

function normAppliesTo(v: unknown): SubjectType[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : [];
  return arr
    .map((x) => str(x).trim())
    .filter((x): x is SubjectType => (SUBJECT_TYPES as readonly string[]).includes(x));
}

export function normaliseDocumentType(raw: unknown): DocumentType | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const code = str(r.code);
  const name = str(r.name);
  const id = optStr(r.id);
  if (!id && !code && !name) return null;
  return {
    id,
    code,
    name,
    appliesTo: normAppliesTo(r.appliesTo ?? r.applies_to),
    mandatory: bool(r.mandatory),
    expiryRequired: bool(r.expiryRequired ?? r.expiry_required),
    verificationRequired: bool(r.verificationRequired ?? r.verification_required),
    enabled: bool(r.enabled, true),
  };
}

export function normaliseDocumentTypes(raw: unknown): DocumentType[] {
  return toArray(raw, "documentTypes", "types")
    .map(normaliseDocumentType)
    .filter((t): t is DocumentType => t !== null);
}

export async function getDocumentTypes(): Promise<LoaderResult<DocumentType[]>> {
  try {
    const res = await browserFetch("v1/crm/document-types");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseDocumentTypes(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createDocumentType(t: DocumentType): Promise<void> {
  const res = await browserFetch("v1/crm/document-types", { method: "POST", body: JSON.stringify(t) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateDocumentType(id: string, t: DocumentType): Promise<void> {
  const res = await browserFetch(`v1/crm/document-types/${id}`, { method: "PUT", body: JSON.stringify(t) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteDocumentType(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/document-types/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/** DM-002 verification action on a document. */
export async function verifyDocument(id: string, status: "verified" | "rejected", reason?: string): Promise<void> {
  const res = await browserFetch(`v1/crm/documents/${id}/verify`, {
    method: "POST",
    body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/* ------------------------------------------------ DM-002 missing/expiring -- */

export type AlertKind = "missing" | "expired" | "expiring";

export interface DocumentAlert {
  kind: AlertKind;
  typeCode: string;
  typeName: string;
  /** Present for expiry alerts — the affected document. */
  document?: Document;
  /** Days until expiry (negative = already expired). */
  daysToExpiry?: number;
}

const EXPIRING_WINDOW_DAYS = 30;

function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return NaN;
  const ms = from.getTime() - to.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * DM-002: derive "missing / expiring" alerts for one record from the document
 * list + the document-type config. Pure + deterministic so it is easily tested
 * and works whether or not the backend ships a dedicated alerts endpoint.
 */
export function computeAlerts(
  subjectType: string,
  docs: Document[],
  types: DocumentType[],
  now: Date = new Date(),
): DocumentAlert[] {
  const alerts: DocumentAlert[] = [];
  const applicable = types.filter(
    (t) => t.enabled && (t.appliesTo.length === 0 || t.appliesTo.includes(subjectType as SubjectType)),
  );
  const currentByType = new Map<string, Document>();
  for (const d of docs) {
    if (!d.isCurrent || !d.docType) continue;
    currentByType.set(d.docType, d);
  }
  for (const t of applicable) {
    const present = currentByType.get(t.code);
    if (t.mandatory && !present) {
      alerts.push({ kind: "missing", typeCode: t.code, typeName: t.name });
      continue;
    }
    if (t.expiryRequired && present?.expiryDate) {
      const days = daysBetween(present.expiryDate, now);
      if (!Number.isNaN(days)) {
        if (days < 0) {
          alerts.push({ kind: "expired", typeCode: t.code, typeName: t.name, document: present, daysToExpiry: days });
        } else if (days <= EXPIRING_WINDOW_DAYS) {
          alerts.push({ kind: "expiring", typeCode: t.code, typeName: t.name, document: present, daysToExpiry: days });
        }
      }
    }
  }
  return alerts;
}
