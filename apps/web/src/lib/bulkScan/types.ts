/**
 * Types for the Admin > Bulk scan UI (GAP-ADMIN-BULK-SCAN-02). They mirror the document-service HTTP contract
 * (/v1/documents/bulk-scan, see services/document-service/src/modules/bulk-scan). Every field the UI does not
 * strictly need is optional so a backend that adds or omits a non-essential field never breaks a page.
 */

export const FILE_STATES = [
  "pending_upload", "uploaded", "scanning", "scan_pending", "queued", "ocr_running", "extracted", "needs_review",
  "ready_to_file", "filed", "failed", "quarantined", "skipped_duplicate", "skipped", "cancelled",
] as const;
export type FileState = (typeof FILE_STATES)[number];

export const BATCH_STATUSES = ["open", "processing", "completed", "cancelled"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const LINK_TARGETS = ["hr_employee", "finance_payment", "finance_voucher", "finance_bill", "eoffice_file"] as const;
export type LinkTarget = (typeof LINK_TARGETS)[number];

export const LINK_STATES = ["awaiting_approval", "linked", "flagged_mismatch", "rejected", "unlink_requested", "unlinked"] as const;
export type LinkState = (typeof LINK_STATES)[number];

export interface LinkRef {
  target: string;
  targetId: string;
}

export interface BatchLinkTarget {
  target: string;
  targetId?: string;
}

export interface BatchProgress {
  total: number;
  settled: number;
  percent: number;
}

export interface BatchView {
  id: string;
  name: string;
  status: string;
  targetFolderId: string | null;
  defaultTags: string[];
  defaultDocType: string | null;
  linkTarget: BatchLinkTarget | null;
  profileId: string | null;
  fileCount: number;
  totalBytes: number;
  counts: Record<string, number>;
  progress: BatchProgress;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
}

/** Link chip shown next to a file; optional additive field on the file view. */
export interface FileLinkChip {
  detail?: { expectedMinor?: string; scannedMinor?: string } | null;
  linkId?: string;
  target: string;
  targetId: string;
  state: string;
  reason?: string | null;
}

export interface BatchFileView {
  id: string;
  batchId: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** Content hash, present once the server has the bytes (after upload). Used to match a re-selected file on resume. */
  sha256: string | null;
  state: string;
  failureReason: string | null;
  failureDetail: string | null;
  deadLetter: boolean;
  attempts: number;
  nextAttemptAt: string | null;
  scanStatus: string | null;
  pageCount: number | null;
  ocrMeanConfidence: number | null;
  docType: string | null;
  piiFlags: string[];
  reviewReasons: string[];
  duplicateOf: string | null;
  filedDocumentId: string | null;
  tags: string[];
  updatedAt: string;
  version: number;
  link: FileLinkChip | null;
}

export interface PageInfo {
  hasMore: boolean;
  pageSize: number;
  total: number | null;
}

export interface Paged<T> {
  items: T[];
  page: PageInfo;
}

export interface ReviewQueueItem {
  batchId: string;
  fileId: string;
  originalName: string;
  docType: string | null;
  confidence: number | null;
  reasons: string[];
  piiFlags: string[];
  pageCount: number | null;
  degradedPages: number;
  batchName: string | null;
  updatedAt: string;
  version: number;
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ReviewWord {
  text: string;
  confidence: number | null;
  bbox: BBox;
}

export interface ReviewPage {
  pageNumber: number;
  width: number;
  height: number;
  imageUrl: string | null;
  text: string;
  meanConfidence: number | null;
  orientationDeg: number;
  script: string | null;
  words: ReviewWord[];
}

export interface ReviewField {
  kind: string;
  value: string;
  raw: string | null;
  confidence: number | null;
  pageNumber: number | null;
  bbox: BBox | null;
}

export interface ClassificationCandidate {
  docType: string;
  label: string;
  /** 0..1 */
  score: number;
}

export interface ReviewClassification {
  docType: string | null;
  confidence: number | null;
  evidence: string[];
  uncertain: boolean;
  /** type set by the batch / scan profile (trusted; the classifier only cross-checks it) */
  presetDocType: string | null;
  /** top-2 classifier candidates (best first) when the classifier ran */
  candidates: ClassificationCandidate[];
}

/** Masked preview ONLY: the raw matched value never reaches the browser. */
export interface ReviewPiiFinding {
  type: string;
  pageNumber: number | null;
  action: string;
  maskedPreview: string;
  bbox: BBox | null;
}

export interface DegradedPage {
  pageNumber: number;
  reason: string;
  droppedScripts: string[];
}

export interface LinkSuggestion {
  target: string;
  targetId: string;
  label: string;
  confidence: number | null;
  amountMinor: string | null;
  reference: string | null;
  mismatch: boolean;
}

export interface DocTypeOption {
  id: string;
  label: string;
}

export interface ReviewFile {
  id: string;
  batchId: string;
  originalName: string;
  state: string;
  docType: string | null;
  confidence: number | null;
  tags: string[];
  reviewReasons: string[];
  version: number;
  link: FileLinkChip | null;
}

/** One of this file's links as listed in the review payload (links[]). */
export interface ReviewLinkInfo {
  linkId: string;
  target: string;
  targetId: string;
  state: string;
  reason: string | null;
  resultReason: string | null;
}

export interface ReviewDetail {
  /** this file's links; used to show maker-checker state without another call */
  links: ReviewLinkInfo[];
  /** tenant setting echoed by the server (null when absent) */
  allowedLinkTargets: string[] | null;
  filingMakerChecker: boolean | null;
  file: ReviewFile;
  pages: ReviewPage[];
  fields: ReviewField[];
  classification: ReviewClassification;
  piiFindings: ReviewPiiFinding[];
  degradedPages: DegradedPage[];
  linkSuggestions: LinkSuggestion[];
  docTypes: DocTypeOption[];
}

export interface LinkRow {
  linkId: string;
  fileId: string;
  documentId: string | null;
  target: string;
  targetId: string;
  state: string;
  requestedBy: string | null;
  approvedBy: string | null;
  reason: string | null;
  /** the target service's own reason code for a flagged / rejected link */
  resultReason: string | null;
  /** PII-free scalars from the target service (AMOUNT_MISMATCH: expectedMinor / scannedMinor digit strings) */
  detail: { expectedMinor?: string; scannedMinor?: string } | null;
  createdAt: string;
}

export interface LookupCandidate {
  target: string;
  targetId: string;
  label: string;
  confidence: number | null;
  amountMinor: string | null;
  reference: string | null;
  mismatch: boolean;
}

/** link-lookup answers 200 even when the target service is down: `error` says which kind of unavailability. */
export interface LookupResult {
  items: LookupCandidate[];
  error: { code: "TARGET_UNAVAILABLE" | "LOOKUP_NOT_CONFIGURED" | "UNKNOWN"; target: string } | null;
}

export interface SearchHit {
  documentId: string;
  fileName: string;
  docType: string | null;
  snippetMasked: string;
  confidence: number | null;
  filedAt: string | null;
  links: LinkRef[];
}

export interface ProviderInfo {
  id: string;
  label: string;
  available: boolean;
  sandbox: boolean;
}

export interface ChangeRequest {
  id: string;
  status: string;
  maker: string;
  checker: string | null;
  reason: string | null;
  decisionReason: string | null;
  sensitive: boolean;
  proposed: Record<string, unknown>;
  /** "profile" for a scan-profile create / update / delete that needs approval; absent for a tenant settings change. */
  kind: string | null;
  profileId: string | null;
  /** What the profile change is: { op: "create" | "update" | "delete", name?, config? } (as sent by the server). */
  profileChange: Record<string, unknown> | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface SettingsPayload {
  settings: Record<string, unknown>;
  version: number;
  degraded: boolean;
  pendingRequests: ChangeRequest[];
}

export interface ProfileRow {
  id: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  version: number;
  updatedAt: string;
}
