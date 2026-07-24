/**
 * AI-assist module — AI provider abstraction (transcription + NLP) with a circuit breaker.
 *
 * Mirrors the VC_Adapter design (design.md § VC_Adapter): a vendor-neutral `AIProvider`
 * interface, concrete provider implementations, and a factory that wraps EVERY provider call in
 * `@civitasone/circuit-breaker` (5 consecutive failures → open for 30s, per steering "Error
 * Handling & Resilience"). When the breaker is open the wrapped provider fails fast with
 * {@link AIUnavailableError}; the consumer catches it and degrades to the manual workflow +
 * secretary notification (design "Graceful degradation").
 *
 * Provider selection is CONFIGURABLE PER TENANT (Req 17.x, steering "all behavior must be
 * configurable per tenant"): `resolveAiConfig` layers per-tenant overrides on top of env
 * defaults. The default provider is the offline, deterministic {@link HeuristicAIProvider} so
 * the service is fully functional in dev/test/on-prem installs without an external AI vendor; an
 * `external` provider is wired to an HTTP endpoint and reports itself unavailable (→ graceful
 * degradation) when not configured, rather than throwing an unhandled error.
 *
 * These capabilities are AI provider concerns only. Knowledge-base search (Req 17.1–17.6) is
 * served by the `@civitasone/search` engine, not this adapter.
 *
 * _Requirements: 7.2 (AI template), 17.1, 17.3, 17.4, 17.5_
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import type { MinutesTemplateType } from "../minutes/domain.js";
import { normalizeConfidence, type ActionCandidate } from "./domain.js";

// ─── Provider I/O contracts ──────────────────────────────────────────────────

/** Input to speech-to-text transcription. `audio` is the recording bytes fetched from S3. */
export interface TranscriptionInput {
  audio: Buffer;
  /** BCP-47-ish language hint (e.g. "hi-en" for Hindi/English), default from config. */
  language?: string;
}

/** Result of transcription. `confidence` in [0, 1] drives the confidence gate (domain.ts). */
export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  language: string;
}

/** Context passed to minutes generation (the meeting's agenda + attendance summary). */
export interface MinutesGenerationContext {
  meetingTitle: string;
  committeeName?: string | null;
  agendaTitles: string[];
  attendeeNames: string[];
}

/** Input to AI minutes drafting. */
export interface MinutesGenerationInput {
  transcript: string;
  template: MinutesTemplateType;
  context: MinutesGenerationContext;
}

/** Result of minutes generation — advisory draft content + candidate actions + confidence. */
export interface MinutesGenerationResult {
  content: string;
  confidence: number;
  suggestedActions: ActionCandidate[];
}

/** Input to action extraction. */
export interface ActionExtractionInput {
  transcript: string;
  attendeeNames: string[];
}

/** Input to next-meeting agenda suggestion. */
export interface AgendaSuggestionInput {
  committeeName?: string | null;
  /** Titles of items from the previous meeting(s) of this committee/series. */
  previousItemTitles: string[];
  /** Descriptions of still-open / overdue action items to carry forward as ATR. */
  openActionDescriptions: string[];
}

/** A single suggested agenda item (advisory). */
export interface AgendaSuggestion {
  title: string;
  rationale: string;
}

/**
 * Vendor-neutral AI provider. Implementations MUST be side-effect-free beyond the AI call
 * itself and MUST NOT persist anything — persistence + the confidence gate + the human-approval
 * invariant are the consumer's responsibility (domain.ts).
 */
export interface AIProvider {
  /** Stable provider identity (for logs / audit metadata). */
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  generateMinutes(input: MinutesGenerationInput): Promise<MinutesGenerationResult>;
  extractActions(input: ActionExtractionInput): Promise<ActionCandidate[]>;
  suggestAgenda(input: AgendaSuggestionInput): Promise<AgendaSuggestion[]>;
}

/**
 * Raised when the AI provider cannot service a request — either the circuit breaker is open or
 * the underlying provider errored/timed out. The consumer treats this as the signal to degrade
 * to the manual workflow and notify the secretary (never a hard failure).
 */
export class AIUnavailableError extends Error {
  constructor(
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(`AI provider "${provider}" is unavailable`);
    this.name = "AIUnavailableError";
  }
}

// ─── Per-tenant configuration (Req 17.x) ─────────────────────────────────────

/** Provider identifiers understood by the factory. */
export type AIProviderName = "heuristic" | "external";

/** Resolved AI configuration for a tenant. */
export interface AIAdapterConfig {
  provider: AIProviderName;
  /** Default transcription language hint. */
  language: string;
  /** Consecutive failures before the breaker trips open (steering: 5). */
  failureThreshold: number;
  /** Recovery window in ms before the breaker probes again (steering: 30s). */
  recoveryMs: number;
  /** HTTP endpoint for the `external` provider (absent ⇒ external provider is unavailable). */
  externalEndpoint?: string;
  /** Stubbed confidence for the deterministic heuristic provider (dev/test), in [0, 1]. */
  stubConfidence: number;
}

/** Per-tenant overrides a caller may layer on top of the env defaults. */
export type AIConfigOverrides = Partial<Omit<AIAdapterConfig, "provider">> & { provider?: AIProviderName };

function isProviderName(v: string | undefined): v is AIProviderName {
  return v === "heuristic" || v === "external";
}

/**
 * Resolve the effective AI configuration for a tenant (Req 17.x). Env vars provide the platform
 * default; `overrides` (sourced per-tenant by the caller) win field-by-field. The `tenantId` is
 * accepted for future per-tenant config lookups and to keep the call site tenant-explicit.
 */
export function resolveAiConfig(_tenantId: string, overrides?: AIConfigOverrides): AIAdapterConfig {
  const envProvider = process.env.AI_PROVIDER;
  const base: AIAdapterConfig = {
    provider: isProviderName(envProvider) ? envProvider : "heuristic",
    language: process.env.AI_LANGUAGE ?? "hi-en",
    failureThreshold: Number(process.env.AI_CB_FAILURE_THRESHOLD ?? 5),
    recoveryMs: Number(process.env.AI_CB_RECOVERY_MS ?? 30_000),
    stubConfidence: normalizeConfidence(Number(process.env.AI_STUB_CONFIDENCE ?? 0.85)),
    ...(process.env.AI_ENDPOINT ? { externalEndpoint: process.env.AI_ENDPOINT } : {}),
  };
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    ...(overrides.stubConfidence !== undefined ? { stubConfidence: normalizeConfidence(overrides.stubConfidence) } : {}),
  };
}

// ─── Heuristic provider (offline, deterministic — dev/test/on-prem default) ──

const ACTION_LINE_RE = /^\s*(?:action|todo|task|follow[- ]?up)\s*[:-]\s*(.+)$/i;
const ASSIGNEE_RE = /@([A-Za-z0-9_.-]{2,40})/;
const DEADLINE_RE = /\b(?:by|before|due)\s+([A-Za-z0-9 ,/-]{3,40})/i;

/**
 * Deterministic, dependency-free AI provider used when no external vendor is configured. It does
 * not perform real ML — it applies simple, predictable heuristics so the whole AI flow (queueing,
 * confidence gate, draft creation, candidate extraction, notifications) is exercisable end-to-end
 * in dev/test/on-prem without a network dependency. Confidence is taken from config so tests can
 * drive both the accept (≥ 0.70) and manual-fallback (< 0.70) branches.
 */
export class HeuristicAIProvider implements AIProvider {
  readonly name = "heuristic";

  constructor(private readonly config: AIAdapterConfig) {}

  transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    // Deterministic placeholder transcript derived from the recording size. Real transcription
    // is delegated to a configured external provider; the heuristic keeps the flow testable.
    const bytes = input.audio.byteLength;
    const transcript =
      `[auto-transcript placeholder]\n` +
      `Recorded audio of ${bytes} bytes processed by the heuristic provider.\n` +
      `ACTION: Secretary to circulate the draft minutes for review.`;
    return Promise.resolve({
      transcript,
      confidence: this.config.stubConfidence,
      language: input.language ?? this.config.language,
    });
  }

  generateMinutes(input: MinutesGenerationInput): Promise<MinutesGenerationResult> {
    const { context } = input;
    const lines: string[] = [];
    lines.push(`# Minutes (AI draft — requires human review): ${context.meetingTitle}`);
    if (context.committeeName) lines.push(`Committee: ${context.committeeName}`);
    lines.push("", "## Attendance");
    lines.push(context.attendeeNames.length ? context.attendeeNames.map((n) => `- ${n}`).join("\n") : "_Not recorded._");
    lines.push("", "## Discussion Summary");
    for (const title of context.agendaTitles) lines.push(`- ${title}: discussed (see transcript).`);
    lines.push("", "## Transcript excerpt");
    lines.push(input.transcript.split("\n").slice(0, 20).join("\n"));
    return Promise.resolve({
      content: lines.join("\n"),
      confidence: this.config.stubConfidence,
      suggestedActions: this.parseActions(input.transcript),
    });
  }

  extractActions(input: ActionExtractionInput): Promise<ActionCandidate[]> {
    return Promise.resolve(this.parseActions(input.transcript));
  }

  suggestAgenda(input: AgendaSuggestionInput): Promise<AgendaSuggestion[]> {
    const suggestions: AgendaSuggestion[] = [];
    // Carry forward open/overdue actions as ATR items (Req 10.x context).
    for (const desc of input.openActionDescriptions) {
      suggestions.push({ title: `ATR: ${desc}`, rationale: "Open action item pending from a previous meeting." });
    }
    // Re-surface prior agenda titles as candidate recurring items.
    for (const title of input.previousItemTitles) {
      suggestions.push({ title, rationale: "Recurred in a previous meeting of this committee." });
    }
    if (suggestions.length === 0) {
      suggestions.push({ title: "Confirmation of previous minutes", rationale: "Standing opening item." });
    }
    return Promise.resolve(suggestions);
  }

  /** Parse "ACTION: …"-style lines from a transcript into candidate action items. */
  private parseActions(transcript: string): ActionCandidate[] {
    const out: ActionCandidate[] = [];
    for (const rawLine of transcript.split("\n")) {
      const m = ACTION_LINE_RE.exec(rawLine);
      if (!m) continue;
      const description = (m[1] ?? "").trim();
      if (!description) continue;
      const assignee = ASSIGNEE_RE.exec(description)?.[1]?.trim();
      const deadline = DEADLINE_RE.exec(description)?.[1]?.trim();
      out.push({
        description,
        ...(assignee ? { assigneeHint: assignee } : {}),
        ...(deadline ? { deadlineHint: deadline } : {}),
        confidence: this.config.stubConfidence,
      });
    }
    return out;
  }
}

// ─── External HTTP provider (stub seam) ──────────────────────────────────────

/**
 * External AI vendor provider. In this build it is a wiring SEAM: without `AI_ENDPOINT`
 * configured it reports every call as unavailable (throwing so the circuit-breaker wrapper
 * surfaces {@link AIUnavailableError} → graceful degradation), rather than pretending to work.
 * A real HTTP integration (with a bounded timeout per steering) slots in behind this class.
 */
export class ExternalAIProvider implements AIProvider {
  readonly name = "external";

  constructor(private readonly config: AIAdapterConfig) {}

  private ensureConfigured(): never {
    throw new Error(
      this.config.externalEndpoint
        ? "external AI provider HTTP integration is not implemented in this build"
        : "external AI provider selected but AI_ENDPOINT is not configured",
    );
  }

  async transcribe(): Promise<TranscriptionResult> {
    this.ensureConfigured();
  }
  async generateMinutes(): Promise<MinutesGenerationResult> {
    this.ensureConfigured();
  }
  async extractActions(): Promise<ActionCandidate[]> {
    this.ensureConfigured();
  }
  async suggestAgenda(): Promise<AgendaSuggestion[]> {
    this.ensureConfigured();
  }
}

// ─── Circuit-breaker wrapper ─────────────────────────────────────────────────

/**
 * Wraps an {@link AIProvider} so every call passes through a single {@link CircuitBreaker}. A
 * provider error (or an open breaker) is normalised to {@link AIUnavailableError}, giving the
 * consumer one exception type to catch for graceful degradation. Sharing one breaker across the
 * provider's methods means repeated failures on ANY capability trip the whole provider open —
 * the correct behaviour when the vendor endpoint is down.
 */
export class CircuitBrokenAIProvider implements AIProvider {
  readonly name: string;
  private readonly breaker: CircuitBreaker;

  constructor(private readonly inner: AIProvider, config: AIAdapterConfig) {
    this.name = inner.name;
    this.breaker = new CircuitBreaker({
      name: `ai-provider:${inner.name}`,
      failureThreshold: config.failureThreshold,
      recoveryMs: config.recoveryMs,
    });
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.breaker.call(fn);
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) throw new AIUnavailableError(this.name, err);
      throw new AIUnavailableError(this.name, err);
    }
  }

  transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    return this.guard(() => this.inner.transcribe(input));
  }
  generateMinutes(input: MinutesGenerationInput): Promise<MinutesGenerationResult> {
    return this.guard(() => this.inner.generateMinutes(input));
  }
  extractActions(input: ActionExtractionInput): Promise<ActionCandidate[]> {
    return this.guard(() => this.inner.extractActions(input));
  }
  suggestAgenda(input: AgendaSuggestionInput): Promise<AgendaSuggestion[]> {
    return this.guard(() => this.inner.suggestAgenda(input));
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Construct the concrete (unwrapped) provider for a resolved config. */
export function createRawProvider(config: AIAdapterConfig): AIProvider {
  switch (config.provider) {
    case "external":
      return new ExternalAIProvider(config);
    case "heuristic":
    default:
      return new HeuristicAIProvider(config);
  }
}

/**
 * Build the circuit-breaker-wrapped AI provider for a tenant (Req 17.x). Resolves per-tenant
 * config (env defaults + overrides), constructs the selected provider, and wraps it so all calls
 * are breaker-guarded and normalised to {@link AIUnavailableError} on failure.
 */
export function createAIAdapter(tenantId: string, overrides?: AIConfigOverrides): AIProvider {
  const config = resolveAiConfig(tenantId, overrides);
  return new CircuitBrokenAIProvider(createRawProvider(config), config);
}
