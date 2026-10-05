/**
 * Fail-CLOSED malware verdict for bulk scan.
 *
 * @civitasone/scanner's scanFile reports "clean" for ANY HTTP 200 whose JSON does not say infected (so a proxy, a wrong
 * endpoint or a differently shaped scanner reply passes as clean). Bulk scan layers positive-clean verification on top:
 * it calls the same ClamAV REST endpoint (same env: CLAMAV_URL, CLAMAV_TIMEOUT_MS) and only answers "clean" when the
 * body EXPLICITLY says so. Everything else (non-200, empty / non-JSON / unexpected body, network error) is "error",
 * which the pipeline treats as scan_pending (fail closed, retried), never as processable.
 *
 * Contract of the scanner reply (the shape the repo's own ClamAV mocks return):
 *                                  clean    = { infected: false } or { status: "clean" } or both ({ infected:false, status:"clean" })
 *                                 infected = { infected: true }  or { status: "infected" }
 * A body that contradicts itself (infected:true with status clean, etc.) is treated as infected.
 */
export type StrictScanVerdict = "clean" | "infected" | "error";

export interface StrictScanConfig { url?: string; timeoutMs?: number; fetchImpl?: typeof fetch }

export function classifyScanBody(body: unknown): StrictScanVerdict {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "error";
  const j = body as { infected?: unknown; status?: unknown };
  const status = typeof j.status === "string" ? j.status : undefined;       // exact, case-sensitive: a bare health-style "ok" / "OK" is NOT clean
  if (j.infected === true || status === "infected") return "infected";
  if (j.infected === false && (status === undefined || status === "clean")) return "clean";
  if (j.infected === undefined && status === "clean") return "clean";
  return "error";
}

export async function scanStrict(buffer: Buffer, filename: string, config: StrictScanConfig = {}): Promise<StrictScanVerdict> {
  const url = config.url ?? process.env.CLAMAV_URL ?? "http://localhost:3310/scan";
  const timeoutMs = config.timeoutMs ?? Number(process.env.CLAMAV_TIMEOUT_MS ?? 10_000);
  const doFetch = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), filename);
    const res = await doFetch(url, { method: "POST", body: form, signal: controller.signal, redirect: "manual" });
    if (res.status !== 200) return "error";
    const text = await res.text();
    if (text.trim() === "") return "error";
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return "error"; }
    return classifyScanBody(parsed);
  } catch {
    return "error";
  } finally {
    clearTimeout(timeout);
  }
}
