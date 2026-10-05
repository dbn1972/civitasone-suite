/**
 * Pure state machine for the resumable, concurrency-bounded upload queue. No I/O: the React hook feeds it events
 * (URLs issued, bytes sent, PUT done, complete acknowledged, failures) and asks it what to do next.
 *
 *   pending --urls--> ready --start--> uploading --ok--> uploaded --complete--> completed
 *      ^                 ^                  |                |
 *      |                 +----- retry ------+-- put fail     +-- complete fail
 *      +------ retry (URL expired / url fail) ------- failed (failedStage: url | put | complete)
 *   invalid: rejected client-side (never uploaded).  on_server: the server already holds it (resume).
 */
import type { Candidate, RejectReason } from "./uploadValidation";

export type ItemStatus = "invalid" | "pending" | "ready" | "uploading" | "uploaded" | "completed" | "failed" | "on_server";
export type FailStage = "url" | "put" | "complete";

/** errorKey set when the object store refused the PUT because the presigned URL expired (retry then needs a fresh URL). */
export const URL_EXPIRED_KEY = "upload.urlExpired";

export interface UploadItem {
  key: string;
  name: string;
  relPath: string;
  size: number;
  mime: string | null;
  status: ItemStatus;
  rejectReason: RejectReason | null;
  fileId: string | null;
  url: string | null;
  headers: Record<string, string> | null;
  /** epoch ms after which the presigned URL is no longer usable */
  urlExpiresAt: number | null;
  loaded: number;
  attempts: number;
  failedStage: FailStage | null;
  /** i18n key (bulkScan.apiError.* / upload.*) describing the last failure */
  errorKey: string | null;
  /** App-standard, already-localised message (plus support reference) when the failure was not a bulk-scan specific code; shown instead of `errorKey`. */
  errorDetail: ErrorDetail | null;
  /** SHA-256 (hex) of the local content when it was computed (resume), else null. */
  sha256: string | null;
}

export interface ErrorDetail { message: string; reference: string | null }

export interface UploadState {
  items: UploadItem[];
}

export const initialUploadState: UploadState = { items: [] };

export type UploadAction =
  | { type: "add"; candidates: Candidate[] }
  | { type: "urls"; assignments: Array<{ key: string; fileId: string; url: string; headers: Record<string, string>; expiresAt: number }> }
  | { type: "reissued"; key: string; url: string; headers: Record<string, string>; expiresAt: number }
  | { type: "adoptPending"; matches: Array<{ key: string; fileId: string }> }
  | { type: "urlFailed"; keys: string[]; errorKey: string; detail?: ErrorDetail | null }
  | { type: "start"; key: string }
  | { type: "progress"; key: string; loaded: number }
  | { type: "putOk"; key: string }
  | { type: "putFailed"; key: string; errorKey: string; detail?: ErrorDetail | null }
  | { type: "completeOk"; keys: string[] }
  | { type: "completeFailed"; keys: string[]; errorKey: string; detail?: ErrorDetail | null }
  | { type: "retryFailed"; now: number }
  | { type: "remove"; key: string }
  | { type: "onServer"; matches: Array<{ key: string; fileId: string }> }
  | { type: "reset" };

function toItem(c: Candidate): UploadItem {
  return {
    key: c.key, name: c.name, relPath: c.relPath, size: c.size, mime: c.mime, status: c.reject ? "invalid" : "pending", rejectReason: c.reject,
    fileId: null, url: null, headers: null, urlExpiresAt: null, loaded: 0, attempts: 0, failedStage: null, errorKey: null, errorDetail: null, sha256: c.sha256 ?? null,
  };
}

function mapKeys(state: UploadState, keys: readonly string[], f: (i: UploadItem) => UploadItem): UploadState {
  const set = new Set(keys);
  return { items: state.items.map((i) => (set.has(i.key) ? f(i) : i)) };
}

export function uploadReducer(state: UploadState, a: UploadAction): UploadState {
  switch (a.type) {
    case "add": {
      const have = new Set(state.items.map((i) => i.key));
      const fresh = a.candidates.filter((c) => !have.has(c.key)).map(toItem);
      return { items: [...state.items, ...fresh] };
    }
    case "urls": {
      const by = new Map(a.assignments.map((x) => [x.key, x]));
      return { items: state.items.map((i) => {
        const x = by.get(i.key);
        return x && i.status === "pending" ? { ...i, status: "ready", fileId: x.fileId, url: x.url, headers: x.headers, urlExpiresAt: x.expiresAt, loaded: 0, failedStage: null, errorKey: null, errorDetail: null } : i;
      }) };
    }
    case "reissued":
      return mapKeys(state, [a.key], (i) => (i.status === "pending" && i.fileId !== null ? { ...i, status: "ready", url: a.url, headers: a.headers, urlExpiresAt: a.expiresAt, loaded: 0, failedStage: null, errorKey: null, errorDetail: null } : i));
    case "adoptPending": {
      // Resume: a re-selected file whose server row is still pending_upload keeps that row (new URL via the re-issue route) instead of registering a second one.
      const by = new Map(a.matches.map((m) => [m.key, m.fileId]));
      return { items: state.items.map((i) => (i.status === "pending" && i.fileId === null && by.has(i.key) ? { ...i, fileId: by.get(i.key)! } : i)) };
    }
    case "urlFailed":
      return mapKeys(state, a.keys, (i) => (i.status === "pending" ? { ...i, status: "failed", failedStage: "url", errorKey: a.errorKey, errorDetail: a.detail ?? null, attempts: i.attempts + 1 } : i));
    case "start":
      return mapKeys(state, [a.key], (i) => (i.status === "ready" ? { ...i, status: "uploading", loaded: 0, attempts: i.attempts + 1, errorKey: null, errorDetail: null } : i));
    // Progress and the PUT outcome are accepted from `ready` as well as `uploading`: the `start` update and the async PUT result are
    // dispatched from different places and must not depend on being applied in a particular order.
    case "progress":
      return mapKeys(state, [a.key], (i) => (i.status === "uploading" || i.status === "ready" ? { ...i, status: "uploading", loaded: Math.max(0, Math.min(i.size, a.loaded)) } : i));
    case "putOk":
      return mapKeys(state, [a.key], (i) => (i.status === "uploading" || i.status === "ready" ? { ...i, status: "uploaded", loaded: i.size } : i));
    case "putFailed":
      return mapKeys(state, [a.key], (i) => (i.status === "uploading" || i.status === "ready" ? { ...i, status: "failed", failedStage: "put", errorKey: a.errorKey, errorDetail: a.detail ?? null } : i));
    case "completeOk":
      return mapKeys(state, a.keys, (i) => (i.status === "uploaded" ? { ...i, status: "completed", errorKey: null, errorDetail: null } : i));
    case "completeFailed":
      return mapKeys(state, a.keys, (i) => (i.status === "uploaded" ? { ...i, status: "failed", failedStage: "complete", errorKey: a.errorKey, errorDetail: a.detail ?? null } : i));
    case "retryFailed":
      return { items: state.items.map((i) => {
        if (i.status !== "failed") return i;
        if (i.failedStage === "complete") return { ...i, status: "uploaded", failedStage: null, errorKey: null, errorDetail: null };
        // A PUT can reuse its presigned URL while it is still valid; otherwise (or after a url failure) ask for a new one.
        const usable = i.failedStage === "put" && i.errorKey !== URL_EXPIRED_KEY && i.url !== null && i.urlExpiresAt !== null && a.now < i.urlExpiresAt - 5000;
        return usable
          ? { ...i, status: "ready", loaded: 0, failedStage: null, errorKey: null, errorDetail: null }
          // fileId is kept: the server row still exists, so a fresh URL is re-issued for it (no second registration).
          : { ...i, status: "pending", url: null, headers: null, urlExpiresAt: null, loaded: 0, failedStage: null, errorKey: null, errorDetail: null };
      }) };
    case "remove":
      return { items: state.items.filter((i) => i.key !== a.key || (i.status !== "invalid" && i.status !== "pending" && i.status !== "failed")) };
    case "onServer":
      return { items: state.items.map((i) => {
        const m = a.matches.find((x) => x.key === i.key);
        return m && (i.status === "pending" || i.status === "failed") ? { ...i, status: "on_server", fileId: m.fileId, failedStage: null, errorKey: null, errorDetail: null, loaded: i.size } : i;
      }) };
    case "reset":
      return initialUploadState;
  }
}

// ── selectors ───────────────────────────────────────────────────

/** Items to start now so that at most `concurrency` uploads run at once. */
export function nextToUpload(state: UploadState, concurrency: number): UploadItem[] {
  const running = state.items.filter((i) => i.status === "uploading").length;
  const slots = Math.max(0, concurrency - running);
  return state.items.filter((i) => i.status === "ready").slice(0, slots);
}

/** Items needing a presigned URL, in chunks the API accepts (<= 200 per call; default 50 keeps responses small). */
export function pendingForUrls(state: UploadState, max = 50): UploadItem[] {
  return state.items.filter((i) => i.status === "pending" && i.fileId === null).slice(0, max);
}

/** Pending items that already have a server row (retry after expiry, or resume): one fresh URL each via the re-issue route. */
export function pendingForReissue(state: UploadState, max = 5): UploadItem[] {
  return state.items.filter((i) => i.status === "pending" && i.fileId !== null).slice(0, max);
}

export function awaitingComplete(state: UploadState, max = 100): UploadItem[] {
  return state.items.filter((i) => i.status === "uploaded" && i.fileId !== null).slice(0, max);
}

export interface UploadSummary {
  total: number;
  invalid: number;
  inProgress: number;
  completed: number;
  failed: number;
  onServer: number;
  totalBytes: number;
  sentBytes: number;
  /** 0..100, over valid items only */
  percent: number;
}

export function summarize(state: UploadState): UploadSummary {
  const valid = state.items.filter((i) => i.status !== "invalid");
  const totalBytes = valid.reduce((a, i) => a + i.size, 0);
  const sentBytes = valid.reduce((a, i) => a + (i.status === "completed" || i.status === "uploaded" || i.status === "on_server" ? i.size : i.status === "uploading" ? i.loaded : 0), 0);
  const c = (s: ItemStatus): number => state.items.filter((i) => i.status === s).length;
  return {
    total: state.items.length,
    invalid: c("invalid"),
    inProgress: c("pending") + c("ready") + c("uploading") + c("uploaded"),
    completed: c("completed"),
    failed: c("failed"),
    onServer: c("on_server"),
    totalBytes,
    sentBytes,
    percent: totalBytes === 0 ? (valid.length > 0 ? 100 : 0) : Math.min(100, Math.floor((sentBytes / totalBytes) * 100)),
  };
}

/** Nothing left to do automatically (only completed / failed / invalid / on_server remain). */
export function isSettled(state: UploadState): boolean {
  return state.items.every((i) => i.status === "completed" || i.status === "failed" || i.status === "invalid" || i.status === "on_server");
}

export function retryableCount(state: UploadState): number {
  return state.items.filter((i) => i.status === "failed").length;
}

/** A server file row, as far as resume matching is concerned. `sha256` is only known once the bytes have been uploaded. */
export interface ServerFileRef { id: string; originalName: string; sizeBytes: number | null; state: string; sha256?: string | null }

export interface MatchOptions {
  /** Keys (path + size) a previous session of this page recorded as uploaded: the only way to tell same-name, same-size files apart without a hash. */
  uploadedKeys?: ReadonlySet<string>;
}

const nameSize = (name: string, size: number | null): string => `${name}\u0000${size ?? ""}`;
/** Two rows whose content hashes are both known and differ are different files, whatever their name and size. */
const compatible = (i: UploadItem, f: ServerFileRef): boolean => !(i.sha256 && f.sha256 && i.sha256 !== f.sha256);

/**
 * Pair re-selected local files with server rows, each row used at most once:
 *   1. by content hash, when both sides have one (exact);
 *   2. otherwise by name + size. When that is ambiguous (several local files or several rows share a name and size) we never guess:
 *      equal counts are paired in path order (every one of them is on the server, whichever row it takes), and otherwise only files
 *      the previous session recorded as uploaded are paired. An unmatched file is simply uploaded again (the server's duplicate
 *      policy catches it), whereas a wrong match would silently drop a file's content.
 */
function pairUp(items: readonly UploadItem[], pool: readonly ServerFileRef[], opts: MatchOptions): Array<{ key: string; fileId: string }> {
  const used = new Set<string>();
  const out: Array<{ key: string; fileId: string }> = [];
  const take = (i: UploadItem, f: ServerFileRef): void => { used.add(f.id); out.push({ key: i.key, fileId: f.id }); };

  const rest: UploadItem[] = [];
  for (const i of items) {
    const hit = i.sha256 ? pool.find((f) => !used.has(f.id) && f.sha256 === i.sha256) : undefined;
    if (hit) take(i, hit); else rest.push(i);
  }

  const groups = new Map<string, UploadItem[]>();
  for (const i of rest) {
    const k = nameSize(i.name, i.size);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  for (const [k, group] of groups) {
    const rows = pool.filter((f) => !used.has(f.id) && nameSize(f.originalName, f.sizeBytes) === k);
    if (rows.length === 0) continue;
    const ordered = [...group].sort((a, b) => a.relPath.localeCompare(b.relPath));
    const chosen = group.length === 1 && rows.length === 1 ? ordered
      : group.length === rows.length ? ordered
        : ordered.filter((i) => opts.uploadedKeys?.has(i.key)).slice(0, rows.length);
    for (const i of chosen) {
      const row = rows.find((f) => !used.has(f.id) && compatible(i, f));
      if (row) take(i, row);
    }
  }
  return out;
}

/** Files the server already holds (state past pending_upload) matched to local items (see `pairUp`). */
export function matchServerFiles(state: UploadState, server: readonly ServerFileRef[], opts: MatchOptions = {}): Array<{ key: string; fileId: string }> {
  const pool = server.filter((f) => f.state !== "pending_upload" && f.state !== "failed" && f.state !== "cancelled");
  return pairUp(state.items.filter((i) => i.status === "pending" || i.status === "failed"), pool, opts);
}

/** Server rows still waiting for their upload (pending_upload) matched to local pending items (see `pairUp`). */
export function matchPendingUploads(state: UploadState, server: readonly ServerFileRef[], opts: MatchOptions = {}): Array<{ key: string; fileId: string }> {
  const pool = server.filter((f) => f.state === "pending_upload");
  return pairUp(state.items.filter((i) => i.status === "pending" && i.fileId === null), pool, opts);
}

/** Minimal manifest persisted to localStorage so a reloaded page can show what still has to be re-selected. */
export interface ManifestEntry { key: string; name: string; relPath: string; size: number; status: ItemStatus }
export function toManifest(state: UploadState): ManifestEntry[] {
  return state.items.filter((i) => i.status !== "invalid").map((i) => ({ key: i.key, name: i.name, relPath: i.relPath, size: i.size, status: i.status }));
}
/** Keys a saved manifest recorded as uploaded (past the PUT): the resume tie-breaker for same-name, same-size files. */
export function uploadedKeysFromManifest(manifest: readonly ManifestEntry[]): Set<string> {
  return new Set(manifest.filter((m) => m.status === "uploaded" || m.status === "completed" || m.status === "on_server").map((m) => m.key));
}
/** Entries from a saved manifest that are not yet safely on the server (need the file to be re-selected). */
export function unfinishedFromManifest(manifest: readonly ManifestEntry[]): ManifestEntry[] {
  return manifest.filter((m) => m.status !== "completed" && m.status !== "on_server");
}

/** Wall-clock expiry from the server's `expiresInSeconds`. */
export function expiryFrom(now: number, expiresInSeconds: number): number {
  return now + Math.max(0, expiresInSeconds) * 1000;
}
