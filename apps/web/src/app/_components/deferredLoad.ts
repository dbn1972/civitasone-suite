"use client";

/**
 * Deferred section loading (UX-R5 performance, S-11 / S-14).
 *
 * Some record-page sections are slow on the server for reasons that are not the page own data: the scanned-
 * documents and medical-insurance reads each publish a DPDP audit-on-read event and wait for the broker
 * (4.5-5.3 s per call measured on UAT, 04 Nov 2026), so rendering them on the server held the whole page
 * (employee detail 9.7-11.4 s, eOffice file 5.2 s). They sit below the fold, so they now load in the browser
 * AFTER the page has loaded: the header, profile and note sheet paint first, and the audit-on-read still
 * happens for every view (the same request is made, just not in the critical path).
 *
 * The result has the same LoaderResult shape the server loaders return, so the section components and their
 * three states (error / empty / data, 403 = permission) are unchanged.
 */
import { useEffect, useState } from "react";
import type { LoaderResult } from "@/app/_data/apiClient";

/** "/api/v1/hrms/..." (gateway path) -> "/api/proxy/v1/hrms/..." (the browser proxy). */
export function proxyPathFor(apiPath: string): string {
  const p = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `/api/proxy${p.replace(/^\/api(?=\/)/, "")}`;
}

/** Run `fn` once the window has finished loading (and the main thread is idle), so it never delays first paint. */
export function afterPageLoad(fn: () => void): () => void {
  let cancelled = false;
  let idleHandle: number | undefined;
  const run = () => {
    if (cancelled) return;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) idleHandle = ric(() => { if (!cancelled) fn(); }, { timeout: 500 });
    else idleHandle = window.setTimeout(() => { if (!cancelled) fn(); }, 0);
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", run);
    const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
    if (idleHandle !== undefined) { if (cic) cic(idleHandle); window.clearTimeout(idleHandle); }
  };
}

/** One browser read through the proxy, mapped like the server loader (never throws). */
export async function loadViaProxy<T>(
  apiPath: string,
  empty: T,
  map: (payload: unknown) => T | null,
  opts: { notFoundAs?: T; signal?: AbortSignal } = {},
): Promise<LoaderResult<T>> {
  try {
    const res = await fetch(proxyPathFor(apiPath), { headers: { accept: "application/json" }, cache: "no-store", signal: opts.signal });
    if (res.status === 404 && opts.notFoundAs !== undefined) return { data: opts.notFoundAs, source: "api", status: 404 };
    if (!res.ok) {
      let errorCode: string | undefined;
      let errorMessage: string | undefined;
      try {
        const body = (await res.json()) as { code?: unknown; message?: unknown };
        if (typeof body?.code === "string") errorCode = body.code;
        if (typeof body?.message === "string") errorMessage = body.message;
      } catch { /* no body */ }
      return { data: empty, source: "error", status: res.status, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) };
    }
    const mapped = map(await res.json());
    return mapped === null ? { data: empty, source: "error", status: res.status } : { data: mapped, source: "api", status: res.status };
  } catch {
    return { data: empty, source: "error" };
  }
}

/** null while waiting for the page to load / the read to answer; then the LoaderResult. */
export function useDeferredResource<T>(
  apiPath: string,
  empty: T,
  map: (payload: unknown) => T | null,
  opts: { notFoundAs?: T } = {},
): LoaderResult<T> | null {
  const [result, setResult] = useState<LoaderResult<T> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    const cancel = afterPageLoad(() => {
      void loadViaProxy(apiPath, empty, map, { ...opts, signal: controller.signal }).then((r) => {
        if (!controller.signal.aborted) setResult(r);
      });
    });
    return () => { cancel(); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the record (path) changes; map/empty are module constants at call sites.
  }, [apiPath]);
  return result;
}
