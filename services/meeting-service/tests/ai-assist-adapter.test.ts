/**
 * AI-assist module — AI provider adapter unit tests (task 17.1, no DB / no network).
 *
 * Covers the vendor-neutral provider abstraction and its resilience wiring:
 *   - resolveAiConfig: env defaults + per-tenant overrides (Req 16 — configurable per tenant).
 *   - HeuristicAIProvider: the offline, deterministic default (transcribe / generateMinutes /
 *     extractActions / suggestAgenda + "ACTION:" line parsing).
 *   - CircuitBrokenAIProvider: provider errors AND an open breaker both normalise to
 *     AIUnavailableError (the single signal the consumer catches for graceful degradation).
 *   - ExternalAIProvider: unconfigured external vendor reports unavailable (→ degradation).
 *
 * _Requirements: 7.2, 16.1, 16.3, 16.4, 16.6_
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  resolveAiConfig,
  createAIAdapter,
  createRawProvider,
  HeuristicAIProvider,
  ExternalAIProvider,
  CircuitBrokenAIProvider,
  AIUnavailableError,
  type AIProvider,
  type AIAdapterConfig,
  type TranscriptionResult,
} from "../src/modules/ai-assist/adapter.js";

const TENANT = "t-adapter-1";

function heuristicConfig(overrides: Partial<AIAdapterConfig> = {}): AIAdapterConfig {
  return {
    provider: "heuristic",
    language: "hi-en",
    failureThreshold: 5,
    recoveryMs: 30_000,
    stubConfidence: 0.85,
    ...overrides,
  };
}

describe("resolveAiConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to the offline heuristic provider", () => {
    delete process.env.AI_PROVIDER;
    const cfg = resolveAiConfig(TENANT);
    expect(cfg.provider).toBe("heuristic");
    expect(cfg.failureThreshold).toBeGreaterThanOrEqual(1);
    expect(cfg.stubConfidence).toBeGreaterThan(0);
  });

  it("applies per-tenant overrides field-by-field and clamps stubConfidence", () => {
    const cfg = resolveAiConfig(TENANT, { provider: "external", stubConfidence: 2, language: "en" });
    expect(cfg.provider).toBe("external");
    expect(cfg.language).toBe("en");
    expect(cfg.stubConfidence).toBe(1); // clamped into [0,1]
  });
});

describe("HeuristicAIProvider", () => {
  const provider = new HeuristicAIProvider(heuristicConfig());

  it("transcribe returns the configured confidence + language", async () => {
    const res = await provider.transcribe({ audio: Buffer.from("audio-bytes"), language: "en" });
    expect(res.confidence).toBe(0.85);
    expect(res.language).toBe("en");
    expect(res.transcript).toContain("ACTION:");
  });

  it("generateMinutes marks the draft as requiring human review and extracts actions", async () => {
    const res = await provider.generateMinutes({
      transcript: "ACTION: @Rao to file the report by Friday\nGeneral discussion.",
      template: "summary",
      context: { meetingTitle: "Board", committeeName: "Finance", agendaTitles: ["Budget"], attendeeNames: ["Rao"] },
    });
    expect(res.content.toLowerCase()).toContain("requires human review");
    expect(res.suggestedActions.length).toBeGreaterThanOrEqual(1);
    expect(res.suggestedActions[0]?.assigneeHint).toBe("Rao");
    expect(res.suggestedActions[0]?.deadlineHint?.toLowerCase()).toContain("friday");
  });

  it("extractActions parses ACTION/TODO/FOLLOW-UP lines only", async () => {
    const candidates = await provider.extractActions({
      transcript: "TODO: prepare agenda\nnormal line\nfollow-up: review minutes",
      attendeeNames: [],
    });
    expect(candidates).toHaveLength(2);
  });

  it("suggestAgenda surfaces open actions (ATR) + recurring items, with a standing fallback", async () => {
    const withContext = await provider.suggestAgenda({
      committeeName: "Finance",
      previousItemTitles: ["Budget review"],
      openActionDescriptions: ["Submit ATR"],
    });
    expect(withContext.some((s) => s.title.startsWith("ATR:"))).toBe(true);
    expect(withContext.some((s) => s.title === "Budget review")).toBe(true);

    const empty = await provider.suggestAgenda({ previousItemTitles: [], openActionDescriptions: [] });
    expect(empty).toHaveLength(1);
    expect(empty[0]?.title).toBe("Confirmation of previous minutes");
  });
});

describe("createRawProvider / createAIAdapter", () => {
  it("builds a heuristic provider by default and wraps it with a breaker", async () => {
    expect(createRawProvider(heuristicConfig()).name).toBe("heuristic");
    const adapter = createAIAdapter(TENANT, { provider: "heuristic", stubConfidence: 0.9 });
    expect(adapter.name).toBe("heuristic");
    const res = await adapter.transcribe({ audio: Buffer.from("x") });
    expect(res.confidence).toBe(0.9);
  });

  it("builds the external provider seam which reports unavailable when unconfigured", async () => {
    const external = createRawProvider(heuristicConfig({ provider: "external" }));
    expect(external).toBeInstanceOf(ExternalAIProvider);
    await expect(external.transcribe({ audio: Buffer.from("x") })).rejects.toBeInstanceOf(Error);
  });
});

describe("CircuitBrokenAIProvider — graceful-degradation signal", () => {
  /** A provider whose calls always reject, to drive the breaker open. */
  class AlwaysFailingProvider implements AIProvider {
    readonly name = "failing";
    transcribe(): Promise<TranscriptionResult> {
      return Promise.reject(new Error("provider boom"));
    }
    generateMinutes(): Promise<never> {
      return Promise.reject(new Error("boom"));
    }
    extractActions(): Promise<never> {
      return Promise.reject(new Error("boom"));
    }
    suggestAgenda(): Promise<never> {
      return Promise.reject(new Error("boom"));
    }
  }

  it("normalises a provider error to AIUnavailableError", async () => {
    const wrapped = new CircuitBrokenAIProvider(new AlwaysFailingProvider(), heuristicConfig({ failureThreshold: 5 }));
    await expect(wrapped.transcribe({ audio: Buffer.from("x") })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("opens after failureThreshold consecutive failures and fails fast (still AIUnavailableError)", async () => {
    const wrapped = new CircuitBrokenAIProvider(new AlwaysFailingProvider(), heuristicConfig({ failureThreshold: 2, recoveryMs: 60_000 }));
    // Two failures trip the breaker...
    await expect(wrapped.transcribe({ audio: Buffer.from("x") })).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(wrapped.transcribe({ audio: Buffer.from("x") })).rejects.toBeInstanceOf(AIUnavailableError);
    // ...the next call is rejected by the open breaker, still surfaced as AIUnavailableError.
    await expect(wrapped.transcribe({ audio: Buffer.from("x") })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("passes through a successful provider result", async () => {
    const wrapped = new CircuitBrokenAIProvider(new HeuristicAIProvider(heuristicConfig({ stubConfidence: 0.77 })), heuristicConfig());
    const res = await wrapped.transcribe({ audio: Buffer.from("x") });
    expect(res.confidence).toBe(0.77);
  });
});
