/** PUT a file to a presigned URL with upload progress (fetch cannot report upload progress). */
export type PutResult = { ok: true } | { ok: false; status: number };
export type PutFn = (args: { url: string; headers: Record<string, string>; body: Blob; onProgress: (loaded: number) => void; signal?: AbortSignal }) => Promise<PutResult>;

export const xhrPut: PutFn = ({ url, headers, body, onProgress, signal }) => new Promise((resolve) => {
  // An already-aborted signal never fires "abort": honour it before sending.
  if (signal?.aborted) { resolve({ ok: false, status: 0 }); return; }
  const xhr = new XMLHttpRequest();
  const onAbort = () => xhr.abort();
  const done = (r: PutResult) => { signal?.removeEventListener("abort", onAbort); resolve(r); };
  xhr.open("PUT", url);
  for (const [k, v] of Object.entries(headers)) {
    // The browser sets Content-Length itself; forwarding it is refused.
    if (k.toLowerCase() !== "content-length") xhr.setRequestHeader(k, v);
  }
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
  xhr.onload = () => done(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, status: xhr.status });
  xhr.onerror = () => done({ ok: false, status: 0 });
  xhr.onabort = () => done({ ok: false, status: 0 });
  signal?.addEventListener("abort", onAbort, { once: true });
  xhr.send(body);
});
