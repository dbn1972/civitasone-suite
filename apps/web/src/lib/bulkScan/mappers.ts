/**
 * Lenient response mappers for the bulk-scan endpoints. Each returns `null` when the payload is not the expected
 * shape at all (so a loader reports source:"error"), and otherwise drops malformed ROWS instead of failing the page.
 * Used by both the server loaders and the client refetch helpers.
 */
import type {
  BatchFileView, BatchLinkTarget, BatchView, BBox, ChangeRequest, DegradedPage, DocTypeOption, FileLinkChip, LinkRow, LinkSuggestion,
  LookupCandidate, Paged, PageInfo, ProfileRow, ProviderInfo, ReviewClassification, ReviewDetail, ReviewField, ReviewFile, ReviewPage,
  ReviewLinkInfo, ReviewPiiFinding, ReviewQueueItem, ReviewWord, SearchHit, SettingsPayload, LookupResult,
} from "./types";
import { parseLinkDetail } from "./linkReason";

type Rec = Record<string, unknown>;

export function asRec(x: unknown): Rec | null {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Rec) : null;
}
const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (v: unknown, fb = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fb);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fb = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fb);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;
const strList = (v: unknown): string[] => asArr(v).filter((x): x is string => typeof x === "string");

/** `{data:[...]}` or a bare array -> the list; anything else -> null. */
export function listOf(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const r = asRec(payload);
  if (r && Array.isArray(r.data)) return r.data;
  return null;
}

export function pageInfoOf(payload: unknown, count: number): PageInfo {
  const p = asRec(asRec(payload)?.pagination);
  return {
    hasMore: p ? bool(p.hasMore) || (typeof p.total === "number" && num(p.offset) + count < p.total) : false,
    pageSize: p ? num(p.pageSize, num(p.limit, count)) : count,
    total: p ? numOrNull(p.total) : null,
  };
}

function mapBBox(v: unknown): BBox | null {
  const r = asRec(v);
  if (!r) return null;
  const { x0, y0, x1, y1 } = r;
  if (![x0, y0, x1, y1].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { x0: x0 as number, y0: y0 as number, x1: x1 as number, y1: y1 as number };
}

function mapLinkChip(v: unknown): FileLinkChip | null {
  const r = asRec(v);
  if (!r || typeof r.state !== "string") return null;
  return {
    ...(typeof r.linkId === "string" ? { linkId: r.linkId } : {}),
    target: str(r.target), targetId: str(r.targetId), state: r.state,
    reason: strOrNull(r.reason),
    detail: parseLinkDetail(r.detail),
  };
}

// ── batches / files ─────────────────────────────────────────────

export function mapBatch(v: unknown): BatchView | null {
  const r = asRec(v);
  if (!r || typeof r.id !== "string" || typeof r.name !== "string") return null;
  const counts: Record<string, number> = {};
  for (const [k, n] of Object.entries(asRec(r.counts) ?? {})) if (typeof n === "number" && Number.isFinite(n)) counts[k] = n;
  const prog = asRec(r.progress);
  const lt = asRec(r.linkTarget);
  const linkTarget: BatchLinkTarget | null = lt && typeof lt.target === "string"
    ? { target: lt.target, ...(typeof lt.targetId === "string" ? { targetId: lt.targetId } : {}) }
    : null;
  return {
    id: r.id, name: r.name, status: str(r.status, "open"), targetFolderId: strOrNull(r.targetFolderId), defaultTags: strList(r.defaultTags),
    defaultDocType: strOrNull(r.defaultDocType), linkTarget, profileId: strOrNull(r.profileId), fileCount: num(r.fileCount), totalBytes: num(r.totalBytes),
    counts, progress: prog ? { total: num(prog.total), settled: num(prog.settled), percent: num(prog.percent) } : { total: 0, settled: 0, percent: 0 },
    createdBy: str(r.createdBy), createdAt: str(r.createdAt), updatedAt: str(r.updatedAt), completedAt: strOrNull(r.completedAt),
    cancelledAt: strOrNull(r.cancelledAt), version: num(r.version, 1),
  };
}

export function mapBatchFile(v: unknown): BatchFileView | null {
  const r = asRec(v);
  if (!r || typeof r.id !== "string" || typeof r.state !== "string") return null;
  return {
    id: r.id, batchId: str(r.batchId), originalName: str(r.originalName, str(r.name)), mimeType: strOrNull(r.mimeType), sizeBytes: numOrNull(r.sizeBytes), sha256: strOrNull(r.sha256),
    state: r.state, failureReason: strOrNull(r.failureReason), failureDetail: strOrNull(r.failureDetail), deadLetter: bool(r.deadLetter),
    attempts: num(r.attempts), nextAttemptAt: strOrNull(r.nextAttemptAt), scanStatus: strOrNull(r.scanStatus), pageCount: numOrNull(r.pageCount),
    ocrMeanConfidence: numOrNull(r.ocrMeanConfidence), docType: strOrNull(r.docType), piiFlags: strList(r.piiFlags), reviewReasons: strList(r.reviewReasons),
    duplicateOf: strOrNull(r.duplicateOf), filedDocumentId: strOrNull(r.filedDocumentId), tags: strList(r.tags), updatedAt: str(r.updatedAt),
    version: num(r.version, 1), link: mapLinkChip(r.link),
  };
}

function mapPaged<T>(payload: unknown, row: (v: unknown) => T | null): Paged<T> | null {
  const list = listOf(payload);
  if (!list) return null;
  const items = list.map(row).filter((x): x is T => x !== null);
  return { items, page: pageInfoOf(payload, items.length) };
}

export const mapBatches = (p: unknown): Paged<BatchView> | null => mapPaged(p, mapBatch);
export const mapBatchFiles = (p: unknown): Paged<BatchFileView> | null => mapPaged(p, mapBatchFile);

// ── review ──────────────────────────────────────────────────────

function mapQueueItem(v: unknown): ReviewQueueItem | null {
  const r = asRec(v);
  if (!r || typeof r.batchId !== "string" || typeof r.fileId !== "string") return null;
  const dp = r.degradedPages;
  return {
    batchId: r.batchId, fileId: r.fileId, originalName: str(r.originalName), docType: strOrNull(r.docType), confidence: numOrNull(r.confidence),
    reasons: strList(r.reasons), piiFlags: strList(r.piiFlags), pageCount: numOrNull(r.pageCount),
    degradedPages: Array.isArray(dp) ? dp.length : num(dp), batchName: strOrNull(r.batchName), updatedAt: str(r.updatedAt), version: num(r.version, 1),
  };
}
export const mapReviewQueue = (p: unknown): Paged<ReviewQueueItem> | null => mapPaged(p, mapQueueItem);

function mapWord(v: unknown): ReviewWord | null {
  const r = asRec(v);
  const bbox = r ? mapBBox(r.bbox) : null;
  if (!r || !bbox || typeof r.text !== "string") return null;
  return { text: r.text, confidence: numOrNull(r.confidence), bbox };
}

function mapPage(v: unknown): ReviewPage | null {
  const r = asRec(v);
  if (!r || typeof r.pageNumber !== "number") return null;
  return {
    pageNumber: r.pageNumber, width: Math.max(1, num(r.width, 1)), height: Math.max(1, num(r.height, 1)), imageUrl: strOrNull(r.imageUrl),
    text: str(r.text), meanConfidence: numOrNull(r.meanConfidence), orientationDeg: num(r.orientationDeg), script: strOrNull(r.script),
    words: asArr(r.words).map(mapWord).filter((w): w is ReviewWord => w !== null),
  };
}

function mapField(v: unknown): ReviewField | null {
  const r = asRec(v);
  if (!r || typeof r.kind !== "string") return null;
  return { kind: r.kind, value: str(r.value), raw: strOrNull(r.raw), confidence: numOrNull(r.confidence), pageNumber: numOrNull(r.pageNumber), bbox: mapBBox(r.bbox) };
}

function mapSuggestion(v: unknown): LinkSuggestion | null {
  const r = asRec(v);
  if (!r || typeof r.target !== "string" || typeof r.targetId !== "string") return null;
  return {
    target: r.target, targetId: r.targetId, label: str(r.label, r.targetId), confidence: numOrNull(r.confidence),
    amountMinor: typeof r.amountMinor === "string" ? r.amountMinor : typeof r.amountMinor === "number" ? String(r.amountMinor) : null,
    reference: strOrNull(r.reference), mismatch: bool(r.mismatch),
  };
}

export function mapReviewDetail(payload: unknown): ReviewDetail | null {
  const root = asRec(payload);
  const r = asRec(root?.data) ?? root;
  const f = asRec(r?.file);
  if (!r || !f) return null;
  const cls = asRec(r.classification);
  const file: ReviewFile = {
    id: str(f.id, str(f.fileId)), batchId: str(f.batchId), originalName: str(f.originalName), state: str(f.state), docType: strOrNull(f.docType),
    confidence: numOrNull(f.confidence ?? f.ocrMeanConfidence), tags: strList(f.tags), reviewReasons: strList(f.reviewReasons),
    version: num(f.version, 1), link: mapLinkChip(f.link),
  };
  const classification: ReviewClassification = {
    docType: cls ? strOrNull(cls.docType) : null, confidence: cls ? numOrNull(cls.confidence) : null,
    evidence: cls ? asArr(cls.evidence).map((e) => (typeof e === "string" ? e : str(asRec(e)?.text))).filter((e) => e.length > 0) : [],
    uncertain: cls ? bool(cls.uncertain) : false,
    presetDocType: cls ? strOrNull(cls.presetDocType) : null,
    candidates: cls
      ? asArr(cls.candidates).flatMap((x) => {
        const c = asRec(x);
        return c && typeof c.docType === "string" && typeof c.score === "number" && Number.isFinite(c.score)
          ? [{ docType: c.docType, label: str(c.label, c.docType), score: Math.min(1, Math.max(0, c.score)) }]
          : [];
      }).sort((a, b) => b.score - a.score).slice(0, 2)
      : [],
  };
  const pii: ReviewPiiFinding[] = asArr(r.piiFindings).flatMap((x) => {
    const p = asRec(x);
    // Only the type, location, action and the already-masked preview are copied: nothing else a finding might carry.
    return p && typeof p.type === "string"
      ? [{ type: p.type, pageNumber: numOrNull(p.pageNumber), action: str(p.action, "flag"), maskedPreview: str(p.maskedPreview), bbox: mapBBox(p.bbox) }]
      : [];
  });
  const degraded: DegradedPage[] = asArr(r.degradedPages).flatMap((x) => {
    const d = asRec(x);
    return d && typeof d.pageNumber === "number" ? [{ pageNumber: d.pageNumber, reason: str(d.reason), droppedScripts: strList(d.droppedScripts) }] : [];
  });
  const docTypes: DocTypeOption[] = asArr(r.docTypes).flatMap((x) => {
    const d = asRec(x);
    return d && typeof d.id === "string" ? [{ id: d.id, label: str(d.label, d.id) }] : [];
  });
  const links: ReviewLinkInfo[] = asArr(r.links).flatMap((x) => {
    const l = asRec(x);
    return l && typeof l.linkId === "string" && typeof l.state === "string"
      ? [{ linkId: l.linkId, target: str(l.target), targetId: str(l.targetId), state: l.state, reason: strOrNull(l.reason), resultReason: strOrNull(l.resultReason) }]
      : [];
  });
  const allowed = Array.isArray(r.allowedLinkTargets) ? strList(r.allowedLinkTargets) : null;
  // The server also lists the reasons at the top level; the file's own list wins when present.
  if (file.reviewReasons.length === 0) file.reviewReasons = strList(r.reasons);
  return {
    links, allowedLinkTargets: allowed, filingMakerChecker: typeof r.filingMakerChecker === "boolean" ? r.filingMakerChecker : null,
    file,
    pages: asArr(r.pages).map(mapPage).filter((p): p is ReviewPage => p !== null).sort((a, b) => a.pageNumber - b.pageNumber),
    fields: asArr(r.fields).map(mapField).filter((x): x is ReviewField => x !== null),
    classification, piiFindings: pii, degradedPages: degraded,
    linkSuggestions: asArr(r.linkSuggestions).map(mapSuggestion).filter((x): x is LinkSuggestion => x !== null),
    docTypes,
  };
}

// ── links / lookup / search ─────────────────────────────────────

function mapLinkRow(v: unknown): LinkRow | null {
  const r = asRec(v);
  if (!r || typeof r.linkId !== "string" || typeof r.state !== "string") return null;
  return {
    linkId: r.linkId, fileId: str(r.fileId), documentId: strOrNull(r.documentId), target: str(r.target), targetId: str(r.targetId), state: r.state,
    requestedBy: strOrNull(r.requestedBy), approvedBy: strOrNull(r.approvedBy), reason: strOrNull(r.reason), resultReason: strOrNull(r.resultReason), detail: parseLinkDetail(r.detail), createdAt: str(r.createdAt),
  };
}
export const mapLinks = (p: unknown): Paged<LinkRow> | null => mapPaged(p, mapLinkRow);

export function mapLookup(payload: unknown): LookupResult | null {
  const list = listOf(payload);
  if (!list) return null;
  const e = asRec(asRec(payload)?.error);
  const code = e ? str(e.code) : "";
  return {
    items: list.map(mapSuggestion).filter((x): x is LookupCandidate => x !== null),
    error: e ? { code: code === "TARGET_UNAVAILABLE" || code === "LOOKUP_NOT_CONFIGURED" ? code : "UNKNOWN", target: str(e.target) } : null,
  };
}

function mapHit(v: unknown): SearchHit | null {
  const r = asRec(v);
  if (!r || typeof r.documentId !== "string") return null;
  return {
    documentId: r.documentId, fileName: str(r.fileName), docType: strOrNull(r.docType), snippetMasked: str(r.snippetMasked), confidence: numOrNull(r.confidence),
    filedAt: strOrNull(r.filedAt),
    links: asArr(r.links).flatMap((x) => { const l = asRec(x); return l && typeof l.target === "string" ? [{ target: l.target, targetId: str(l.targetId) }] : []; }),
  };
}
export const mapSearch = (p: unknown): Paged<SearchHit> | null => mapPaged(p, mapHit);

// ── settings / profiles / providers ─────────────────────────────

function mapChangeRequest(v: unknown): ChangeRequest | null {
  const r = asRec(v);
  if (!r || typeof r.id !== "string") return null;
  return {
    id: r.id, status: str(r.status, "pending"), maker: str(r.maker), checker: strOrNull(r.checker), reason: strOrNull(r.reason),
    decisionReason: strOrNull(r.decisionReason), sensitive: bool(r.sensitive), proposed: asRec(r.proposed) ?? {}, kind: strOrNull(r.kind), profileId: strOrNull(r.profileId),
    profileChange: asRec(r.profileChange), createdAt: str(r.createdAt),
    decidedAt: strOrNull(r.decidedAt),
  };
}
export function mapChangeRequests(payload: unknown): ChangeRequest[] | null {
  const list = listOf(payload);
  return list ? list.map(mapChangeRequest).filter((x): x is ChangeRequest => x !== null) : null;
}

export function mapSettings(payload: unknown): SettingsPayload | null {
  const r = asRec(payload);
  const s = asRec(r?.settings);
  if (!r || !s) return null;
  return { settings: s, version: num(r.version), degraded: bool(r.degraded), pendingRequests: mapChangeRequests({ data: r.pendingRequests }) ?? [] };
}

function mapProfile(v: unknown): ProfileRow | null {
  const r = asRec(v);
  if (!r || typeof r.id !== "string" || typeof r.name !== "string") return null;
  return { id: r.id, name: r.name, description: strOrNull(r.description), config: asRec(r.config) ?? {}, version: num(r.version, 1), updatedAt: str(r.updatedAt) };
}
export function mapProfiles(payload: unknown): ProfileRow[] | null {
  const list = listOf(payload);
  return list ? list.map(mapProfile).filter((x): x is ProfileRow => x !== null) : null;
}

export function mapProviders(payload: unknown): ProviderInfo[] | null {
  const list = listOf(payload);
  if (!list) return null;
  return list.flatMap((x) => {
    const r = asRec(x);
    return r && typeof r.id === "string" ? [{ id: r.id, label: str(r.label, r.id), available: bool(r.available), sandbox: bool(r.sandbox) }] : [];
  });
}
