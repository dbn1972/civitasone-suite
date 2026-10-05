/**
 * Per-tenant ordered OCR provider chain.
 *
 * Every provider is wrapped with: a circuit breaker (@civitasone/circuit-breaker, one per provider,
 * persisting for the life of the chain), a per-attempt timeout (AbortSignal + hard race), and retry
 * with exponential, jittered backoff (injectable clock/random). On failure, circuit-open or
 * "unavailable" the next provider is tried. Optional best-of mode: pages whose mean confidence is
 * below a threshold are re-run on the next provider(s) and the higher-confidence page is kept.
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { OcrChainError, OcrTimeoutError } from "./errors.js";
import { systemClock, normaliseLangs, type OcrClock } from "./port.js";
import {
  OcrNotImplementedError, OcrProviderError,
  type DocumentOcrResult, type OcrLang, type OcrProvider, type OcrProviderId, type PageImage, type PageProviderId, type PageResult,
  type ProviderAttemptDiagnostic,
} from "./types.js";

export interface ChainProviderConfig {
  provider: OcrProvider;
  /** Per-attempt timeout. Default 60000. */
  timeoutMs?: number;
  /** Total attempts incl. the first. Default 2. */
  maxAttempts?: number;
  /** Backoff base (ms) for attempt n: min(max, base * 2^(n-1)) * (0.5 + 0.5*random). Default 250. */
  backoffBaseMs?: number;
  /** Backoff cap (ms). Default 5000. */
  backoffMaxMs?: number;
  /** Consecutive failures before the breaker opens (default 5) and recovery window (default 30000). */
  breaker?: { failureThreshold?: number; recoveryMs?: number };
}

export interface BestOfConfig { enabled: boolean; /** pages with meanConfidence below this (0..1) are retried. */ threshold: number }

export interface OcrChainConfig {
  providers: ChainProviderConfig[];
  langs: OcrLang[];
  bestOf?: BestOfConfig;
  clock?: OcrClock;
}

type RunOutcome =
  | { ok: true; results: PageResult[]; attempts: number }
  | { ok: false; outcome: "failed" | "circuit_open" | "timeout"; error: unknown; attempts: number };

interface Entry { cfg: ChainProviderConfig; breaker: CircuitBreaker }

/** Thrown (by the chain's timeout wrapper) when the CALLER's signal aborts an in-flight provider call. */
export class OcrCallerAbortError extends OcrProviderError {
  constructor(providerId: OcrProviderId) {
    super(providerId, "aborted", false);
    this.name = "OcrCallerAbortError";
  }
}

export class OcrChain {
  private readonly entries: Entry[];
  private readonly clock: OcrClock;
  private readonly langs: OcrLang[];
  private readonly bestOf: BestOfConfig;

  constructor(cfg: OcrChainConfig) {
    if (cfg.providers.length === 0) throw new RangeError("OcrChain needs at least one provider");
    this.langs = normaliseLangs(cfg.langs);
    this.clock = cfg.clock ?? systemClock;
    this.bestOf = cfg.bestOf ?? { enabled: false, threshold: 0 };
    this.entries = cfg.providers.map((p) => ({
      cfg: p,
      breaker: new CircuitBreaker({
        name: `ocr:${p.provider.id}`,
        failureThreshold: p.breaker?.failureThreshold ?? 5,
        recoveryMs: p.breaker?.recoveryMs ?? 30_000,
        // a caller-side abort (batch cancelled) says nothing about provider health: never count it (timeouts still do)
        countsAsFailure: (err) => !(err instanceof OcrCallerAbortError),
      }),
    }));
  }

  /** Breaker state per provider id (monitoring / tests). */
  breakerStates(): Record<string, string> {
    return Object.fromEntries(this.entries.map((e) => [e.cfg.provider.id, e.breaker.state]));
  }

  async recognize(pages: PageImage[], opts: { signal?: AbortSignal } = {}): Promise<DocumentOcrResult> {
    const diagnostics: ProviderAttemptDiagnostic[] = [];
    const causes: Array<{ providerId: string; error: unknown }> = [];
    const best = new Map<number, PageResult>();
    if (pages.length === 0) return assembleDocumentResult([], diagnostics);
    let primaryDone = false;

    for (const entry of this.entries) {
      const id = entry.cfg.provider.id;
      let targets: PageImage[];
      if (!primaryDone) {
        targets = pages;
      } else {
        if (!this.bestOf.enabled) break;
        targets = pages.filter((p) => (best.get(p.pageNumber)?.meanConfidence ?? 0) < this.bestOf.threshold);
        if (targets.length === 0) break;
      }
      if (opts.signal?.aborted) throw new OcrChainError("OCR aborted", causes);

      let available = false;
      try { available = await entry.cfg.provider.isAvailable(); } catch { available = false; }
      if (!available) {
        diagnostics.push({ providerId: id, outcome: "skipped_unavailable", attempts: 0 });
        continue;
      }

      const run = await this.runProvider(entry, targets, opts.signal);
      if (!run.ok) {
        diagnostics.push({ providerId: id, outcome: run.outcome, attempts: run.attempts, error: errMsg(run.error) });
        causes.push({ providerId: id, error: run.error });
        continue;
      }
      if (!primaryDone) {
        for (const r of run.results) best.set(r.pageNumber, r);
        primaryDone = true;
        diagnostics.push({ providerId: id, outcome: "ok", attempts: run.attempts, pages: targets.map((t) => t.pageNumber) });
      } else {
        const replaced: number[] = [];
        const kept: number[] = [];
        for (const r of run.results) {
          const cur = best.get(r.pageNumber);
          if (!cur || r.meanConfidence > cur.meanConfidence) { best.set(r.pageNumber, r); replaced.push(r.pageNumber); } else kept.push(r.pageNumber);
        }
        if (replaced.length) diagnostics.push({ providerId: id, outcome: "best_of_replaced", attempts: run.attempts, pages: replaced });
        if (kept.length) diagnostics.push({ providerId: id, outcome: "best_of_kept", attempts: run.attempts, pages: kept });
      }
    }

    if (!primaryDone) {
      const summary = causes.length
        ? causes.map((c) => `${c.providerId}: ${errMsg(c.error)}`).join("; ")
        : "no provider available";
      throw new OcrChainError(`All OCR providers failed or were unavailable (${summary})`, causes);
    }
    const ordered = pages.map((p) => best.get(p.pageNumber)).filter((r): r is PageResult => r !== undefined);
    return assembleDocumentResult(ordered, diagnostics);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.entries.map((e) => e.cfg.provider.dispose()));
  }

  private async runProvider(entry: Entry, pages: PageImage[], signal: AbortSignal | undefined): Promise<RunOutcome> {
    const { provider } = entry.cfg;
    const timeoutMs = entry.cfg.timeoutMs ?? 60_000;
    const maxAttempts = Math.max(1, entry.cfg.maxAttempts ?? 2);
    const base = entry.cfg.backoffBaseMs ?? 250;
    const cap = entry.cfg.backoffMaxMs ?? 5_000;
    let attempts = 0;
    let lastErr: unknown;
    let lastOutcome: "failed" | "timeout" = "failed";

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const results = await entry.breaker.call(() => withTimeout(
          (sig) => provider.recognize(pages, { langs: this.langs, timeoutMs, signal: sig }),
          timeoutMs, provider.id, signal,
        ));
        const got = new Set(results.map((r) => r.pageNumber));
        const missing = pages.filter((p) => !got.has(p.pageNumber));
        if (missing.length > 0) throw new OcrProviderError(provider.id, `provider returned no result for page(s) ${missing.map((m) => m.pageNumber).join(",")}`, false);
        return { ok: true, results, attempts };
      } catch (err) {
        if (err instanceof CircuitBreakerOpenError) return { ok: false, outcome: "circuit_open", error: err, attempts: attempts - 1 };
        lastErr = err;
        lastOutcome = err instanceof OcrTimeoutError ? "timeout" : "failed";
        if (!isRetryable(err) || signal?.aborted) break;
        if (attempts < maxAttempts) {
          const delay = Math.round(Math.min(cap, base * 2 ** (attempts - 1)) * (0.5 + 0.5 * this.clock.random()));
          await this.clock.sleep(delay);
        }
      }
    }
    return { ok: false, outcome: lastOutcome, error: lastErr, attempts };
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OcrNotImplementedError) return false;
  if (err instanceof OcrProviderError) return err.retryable;
  return true;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, providerId: OcrProviderId, outer: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ac = new AbortController();
    const onOuter = (): void => { ac.abort(); reject(new OcrCallerAbortError(providerId)); };
    if (outer?.aborted) { onOuter(); return; }
    outer?.addEventListener("abort", onOuter, { once: true });
    const timer = setTimeout(() => { ac.abort(); reject(new OcrTimeoutError(providerId, ms)); }, ms);
    fn(ac.signal).then(
      (v) => { clearTimeout(timer); outer?.removeEventListener("abort", onOuter); resolve(v); },
      (e: unknown) => { clearTimeout(timer); outer?.removeEventListener("abort", onOuter); reject(e); },
    );
  });
}

/** Joins page results into a DocumentOcrResult (pages separated by form-feed). */
export function assembleDocumentResult(pages: PageResult[], diagnostics?: ProviderAttemptDiagnostic[]): DocumentOcrResult {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const withText = sorted.filter((p) => p.text.trim().length > 0);
  const mean = withText.length ? withText.reduce((a, p) => a + p.meanConfidence, 0) / withText.length : 0;
  const providerIds: PageProviderId[] = [];
  for (const p of sorted) if (!providerIds.includes(p.providerId)) providerIds.push(p.providerId);
  return {
    pages: sorted,
    text: sorted.map((p) => p.text).join("\f"),
    meanConfidence: mean,
    providerIds,
    pageCount: sorted.length,
    ...(diagnostics ? { diagnostics } : {}),
  };
}
