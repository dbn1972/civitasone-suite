"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { bsRequest, specificErrorKey, type FailedResult } from "@/lib/bulkScan/api";
import { isAllowedUploadUrl } from "@/lib/bulkScan/uploadUrl";
import { useBulkScanError } from "@/lib/bulkScan/useBulkScanError";
import {
  awaitingComplete, expiryFrom, initialUploadState, matchPendingUploads, matchServerFiles, nextToUpload, pendingForReissue, pendingForUrls, summarize, uploadReducer, URL_EXPIRED_KEY,
  type ErrorDetail, type MatchOptions, type UploadItem,
} from "@/lib/bulkScan/uploadQueue";
import type { Candidate } from "@/lib/bulkScan/uploadValidation";
import { xhrPut, type PutFn } from "@/lib/bulkScan/xhrPut";

export const UPLOAD_CONCURRENCY = 3;

type ServerFile = Parameters<typeof matchServerFiles>[1][number];

interface Deps { put?: PutFn; now?: () => number; concurrency?: number }

/** True when the server answered with at least one upload URL that is not allowed (plain http outside development). */
function hasInsecureUrl(json: unknown): boolean {
  const root = json !== null && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const data = root && typeof root.data === "object" && root.data !== null ? (root.data as Record<string, unknown>) : null;
  const list = data && Array.isArray(data.uploads) ? data.uploads : [];
  return list.some((u) => {
    const url = u !== null && typeof u === "object" ? (u as Record<string, unknown>).url : null;
    return typeof url === "string" && !isAllowedUploadUrl(url);
  });
}

function parseUploads(json: unknown): Array<{ fileId: string; url: string; headers: Record<string, string>; expiresInSeconds: number }> | null {
  const root = json !== null && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const data = root && typeof root.data === "object" && root.data !== null ? (root.data as Record<string, unknown>) : null;
  if (!data || !Array.isArray(data.uploads)) return null;
  const out: Array<{ fileId: string; url: string; headers: Record<string, string>; expiresInSeconds: number }> = [];
  for (const u of data.uploads) {
    const r = u !== null && typeof u === "object" ? (u as Record<string, unknown>) : null;
    if (!r || typeof r.fileId !== "string" || typeof r.url !== "string" || !isAllowedUploadUrl(r.url)) return null;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers !== null && typeof r.headers === "object" ? (r.headers as Record<string, unknown>) : {})) if (typeof v === "string") headers[k] = v;
    out.push({ fileId: r.fileId, url: r.url, headers, expiresInSeconds: typeof r.expiresInSeconds === "number" ? r.expiresInSeconds : 900 });
  }
  return out;
}

/**
 * Drives the pure upload queue: asks for presigned URLs (chunks of 50), PUTs with a bounded number of concurrent uploads and
 * per-file progress, then confirms with files/complete. Failed items stay failed until `retryFailed()` (resumable: a retry
 * reuses a still-valid URL, otherwise asks for a new one).
 */
export function useUploadEngine(batchId: string | null, deps: Deps = {}) {
  const { put = xhrPut, now = Date.now, concurrency = UPLOAD_CONCURRENCY } = deps;
  const t = useTranslations("bulkScan");
  const describe = useBulkScanError(t("review.area"));
  const describeRef = useRef(describe);
  describeRef.current = describe;
  /** Specific bulk-scan copy by key, else the app-standard message (with its support reference). */
  const failure = useCallback((r: FailedResult): { errorKey: string; detail: ErrorDetail | null } => {
    const key = specificErrorKey(r);
    return key !== null ? { errorKey: key, detail: null } : { errorKey: "apiError.generic", detail: describeRef.current(r) };
  }, []);
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const files = useRef(new Map<string, File>());
  const inflightUrls = useRef(false);
  const inflightComplete = useRef(false);
  const putting = useRef(new Set<string>());
  /** uploads currently in flight; bounds concurrency independently of when state updates are applied */
  const inflightPuts = useRef(0);
  const reissuing = useRef(new Set<string>());
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Add validated files. When the server already holds some of them (a resumed batch) they are marked on_server in the SAME
   * update, so the engine never requests a second upload slot for a file that is already there.
   */
  const addCandidates = useCallback((cands: Candidate[], fileMap: Map<string, File>, server: ServerFile[] = [], opts: MatchOptions = {}) => {
    for (const [k, f] of fileMap) files.current.set(k, f);
    dispatch({ type: "add", candidates: cands });
    if (server.length > 0) {
      const merged = uploadReducer(stateRef.current, { type: "add", candidates: cands });
      const onServer = matchServerFiles(merged, server, opts);
      dispatch({ type: "onServer", matches: onServer });
      dispatch({ type: "adoptPending", matches: matchPendingUploads(uploadReducer(merged, { type: "onServer", matches: onServer }), server, opts) });
    }
  }, []);

  useEffect(() => {
    if (!batchId || paused) return;

    const urlItems = pendingForUrls(state, 50);
    if (urlItems.length > 0 && !inflightUrls.current) {
      inflightUrls.current = true;
      void (async () => {
        const r = await bsRequest(`/batches/${encodeURIComponent(batchId)}/files/upload-urls`, {
          method: "POST",
          body: { files: urlItems.map((i) => ({ name: i.name, mimeType: i.mime, sizeBytes: i.size })) },
        });
        const keys = urlItems.map((i) => i.key);
        if (!r.ok) dispatch({ type: "urlFailed", keys, ...failure(r) });
        else {
          const ups = parseUploads(r.json);
          if (hasInsecureUrl(r.json)) dispatch({ type: "urlFailed", keys, errorKey: "upload.insecureUrl" });
          else if (!ups || ups.length !== urlItems.length) dispatch({ type: "urlFailed", keys, errorKey: "upload.badResponse" });
          else {
            const at = now();
            dispatch({ type: "urls", assignments: urlItems.map((i, n) => ({ key: i.key, fileId: ups[n]!.fileId, url: ups[n]!.url, headers: ups[n]!.headers, expiresAt: expiryFrom(at, ups[n]!.expiresInSeconds) })) });
          }
        }
        inflightUrls.current = false;
        setTick((t) => t + 1);
      })();
    }

    const reissue = pendingForReissue(state, concurrency).filter((i) => !reissuing.current.has(i.key));
    for (const item of reissue) {
      reissuing.current.add(item.key);
      void (async () => {
        const r = await bsRequest(`/batches/${encodeURIComponent(batchId)}/files/${encodeURIComponent(item.fileId ?? "")}/upload-url`, { method: "POST" });
        const up = r.ok ? parseUploads({ data: { uploads: [{ ...(((r.json as { data?: object } | null)?.data) ?? {}) }] } }) : null;
        if (r.ok && up && up.length === 1) dispatch({ type: "reissued", key: item.key, url: up[0]!.url, headers: up[0]!.headers, expiresAt: expiryFrom(now(), up[0]!.expiresInSeconds) });
        // The file already moved on (uploaded / skipped / expired): it is no longer ours to upload, treat it as on the server and let the list refresh.
        else if (!r.ok && r.code === "NOT_PENDING_UPLOAD") dispatch({ type: "onServer", matches: [{ key: item.key, fileId: item.fileId ?? "" }] });
        else if (r.ok && hasInsecureUrl({ data: { uploads: [(r.json as { data?: object } | null)?.data ?? {}] } })) dispatch({ type: "urlFailed", keys: [item.key], errorKey: "upload.insecureUrl" });
        else dispatch({ type: "urlFailed", keys: [item.key], ...(r.ok ? { errorKey: "upload.badResponse" } : failure(r)) });
        reissuing.current.delete(item.key);
        setTick((t) => t + 1);
      })();
    }

    for (const item of nextToUpload(state, concurrency)) {
      if (putting.current.has(item.key)) continue;
      if (inflightPuts.current >= concurrency) break;
      const file = files.current.get(item.key);
      putting.current.add(item.key);
      inflightPuts.current += 1;
      dispatch({ type: "start", key: item.key });
      void (async (it: UploadItem) => {
        if (!file || !it.url) { dispatch({ type: "putFailed", key: it.key, errorKey: "upload.fileMissing" }); inflightPuts.current -= 1; return; }
        const res = await put({ url: it.url, headers: it.headers ?? {}, body: file, onProgress: (loaded) => dispatch({ type: "progress", key: it.key, loaded }) });
        if (res.ok) dispatch({ type: "putOk", key: it.key });
        else dispatch({ type: "putFailed", key: it.key, errorKey: res.status === 403 ? URL_EXPIRED_KEY : "upload.putFailed" });
        inflightPuts.current -= 1;
        // The key stays in `putting` until the next retry: an item is PUT at most once per attempt, whatever happens to the state updates.
        setTick((t) => t + 1);
      })(item);
    }

    const done = awaitingComplete(state, 100);
    if (done.length > 0 && !inflightComplete.current) {
      inflightComplete.current = true;
      void (async () => {
        const keys = done.map((i) => i.key);
        const r = await bsRequest(`/batches/${encodeURIComponent(batchId)}/files/complete`, { method: "POST", body: { files: done.map((i) => ({ fileId: i.fileId })) } });
        dispatch(r.ok ? { type: "completeOk", keys } : { type: "completeFailed", keys, ...failure(r) });
        inflightComplete.current = false;
        setTick((t) => t + 1);
      })();
    }
  }, [state, batchId, paused, tick, concurrency, put, now, failure]);

  const retryFailed = useCallback(() => { putting.current.clear(); dispatch({ type: "retryFailed", now: now() }); }, [now]);
  const remove = useCallback((key: string) => { files.current.delete(key); dispatch({ type: "remove", key }); }, []);

  return { state, summary: summarize(state), addCandidates, retryFailed, remove, paused, setPaused };
}
