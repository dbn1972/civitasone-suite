/**
 * VC-integration module — VC_Adapter abstraction (Requirement 13).
 *
 * Provides a vendor-neutral interface for video-conference platforms so the rest of the
 * service never depends on a single provider (Req 13.1). The unified interface covers
 * createSession, getJoinLink, getParticipants, startRecording, stopRecording and
 * endSession regardless of the underlying platform (Req 13.7).
 *
 * Resilience (steering "Error Handling & Resilience" + Req 13.6):
 *   - Every outbound provider call is wrapped with @civitasone/circuit-breaker
 *     (5 consecutive failures → open for 30s). The suite breaker counts CONSECUTIVE
 *     failures, which is the established pattern across sibling adapters (gem, digilocker).
 *   - Every outbound HTTP call has a hard timeout (default 10s, env-configurable). No
 *     unbounded awaits.
 *
 * Fallback (Req 13.5): providers are tried in a priority order that is configurable per
 * tenant. When the active provider's breaker is open (or the call fails), the chain falls
 * through to the next provider and reports the switch to the caller so the secretary can
 * be notified. When every configured provider is unavailable the chain throws
 * {@link VCAllPlatformsUnavailableError} (code `VC_ALL_PLATFORMS_UNAVAILABLE`).
 *
 * Testability: the provider adapters are stubs that return realistic shapes today; the real
 * HTTP calls sit behind env-configured base URLs (activated once `apiKey` is present). The
 * fallback SELECTION logic is factored into the pure {@link selectFallbackProvider} function
 * so it can be property-tested (P21) without any network or breaker state.
 *
 * _Requirements: 13.1, 13.2, 13.5, 13.6, 13.7_
 */
import { randomUUID } from "node:crypto";
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Supported video-conference platforms (Req 13.1) — the single source of the provider enum. */
export const VC_PROVIDERS = ["nic_vc", "ms_teams", "google_meet", "zoom", "webrtc"] as const;

/** Supported video-conference platforms (Req 13.1). */
export type VCProvider = (typeof VC_PROVIDERS)[number];

export interface VCSession {
  externalId: string;
  joinUrl: string;
  dialInNumber?: string | undefined;
  meetingPin?: string | undefined;
  hostUrl?: string | undefined;
}

export interface VCParticipant {
  externalUserId: string;
  displayName: string;
  joinedAt: Date;
  leftAt?: Date | undefined;
  role: "host" | "participant" | "viewer";
}

export interface VCRecording {
  recordingUrl: string;
  storageKey: string;
  durationSeconds: number;
  sizeBytes: number;
}

export interface VCAdapterConfig {
  provider: VCProvider;
  apiBaseUrl: string;
  apiKey: string;
  apiSecret?: string | undefined;
  tenantId?: string | undefined;
  /** Outbound HTTP timeout in ms. Defaults to {@link DEFAULT_VC_TIMEOUT_MS}. */
  timeout?: number | undefined;
}

export interface CreateSessionParams {
  meetingId: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  hostEmail: string;
  participants: string[];
}

/** Unified provider-neutral VC interface (Req 13.7). */
export interface VCAdapter {
  readonly provider: VCProvider;

  /** Create a new VC session for a meeting. */
  createSession(params: CreateSessionParams): Promise<VCSession>;

  /** Get the join link for an existing session. */
  getJoinLink(externalId: string): Promise<string>;

  /** Get current participants in an active session. */
  getParticipants(externalId: string): Promise<VCParticipant[]>;

  /** Start recording for the session. */
  startRecording(externalId: string): Promise<void>;

  /** Stop recording and retrieve recording details. */
  stopRecording(externalId: string): Promise<VCRecording>;

  /** End the VC session. */
  endSession(externalId: string): Promise<void>;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Default outbound HTTP timeout for provider calls (steering: default 10s, no unbounded awaits). */
export const DEFAULT_VC_TIMEOUT_MS = 10_000;

/** Circuit breaker trip threshold — consecutive failures before opening (Req 13.6). */
export const VC_BREAKER_FAILURE_THRESHOLD = 5;

/** Circuit breaker recovery window in ms — time in open before probing half-open (Req 13.6). */
export const VC_BREAKER_RECOVERY_MS = 30_000;

/**
 * Priority-ordered fallback chain (Req 13.5). Tenants may override this order via their VC
 * configuration; NIC VC leads (mandatory for government) and WebRTC anchors the chain as the
 * always-available self-hosted option.
 */
export const DEFAULT_PROVIDER_PRIORITY: readonly VCProvider[] = [
  "nic_vc",
  "ms_teams",
  "google_meet",
  "zoom",
  "webrtc",
];

// ── Errors ────────────────────────────────────────────────────────────────────

/** Raised by a provider adapter when a provider-side call fails (non-2xx / transport error). */
export class VCAdapterError extends Error {
  constructor(
    message: string,
    public readonly provider: VCProvider,
    public readonly code: string,
    public readonly httpStatus?: number | undefined,
  ) {
    super(message);
    this.name = "VCAdapterError";
  }
}

/** One failed attempt in the fallback chain, retained for logging / secretary notification. */
export interface VCAttempt {
  provider: VCProvider;
  /** `circuit_open` when the breaker rejected the call, otherwise the thrown error's reason. */
  reason: string;
}

/**
 * Raised when every configured provider in the fallback chain is unavailable (open or failing).
 * Maps to a service-level `VC_ALL_PLATFORMS_UNAVAILABLE` condition (Req 13.5).
 */
export class VCAllPlatformsUnavailableError extends Error {
  readonly code = "VC_ALL_PLATFORMS_UNAVAILABLE";
  constructor(public readonly attempts: VCAttempt[]) {
    super(
      `All configured VC platforms are unavailable (tried: ${
        attempts.map((a) => `${a.provider}:${a.reason}`).join(", ") || "none configured"
      })`,
    );
    this.name = "VCAllPlatformsUnavailableError";
  }
}

// ── Pure fallback selection (P21 target) ───────────────────────────────────────

/**
 * Select the next provider to attempt from a priority-ordered candidate list, skipping any
 * whose circuit breaker is currently open.
 *
 * Pure and side-effect free: `isOpen` is the only observation of external state, injected so
 * this function can be exercised deterministically by property tests (P21) without real
 * breakers or network. Returns the first non-open provider in priority order, or `null` when
 * every candidate is open.
 */
export function selectFallbackProvider(
  priority: readonly VCProvider[],
  isOpen: (provider: VCProvider) => boolean,
): VCProvider | null {
  for (const provider of priority) {
    if (!isOpen(provider)) return provider;
  }
  return null;
}

// ── HTTP helper (timeout-bounded) ───────────────────────────────────────────────

/**
 * Fetch with a hard timeout via AbortController (steering: all outbound HTTP calls must have a
 * timeout; no unbounded awaits). Mirrors the pattern used by sibling adapters (gem, digilocker).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Base provider adapter ───────────────────────────────────────────────────────

/**
 * Shared behaviour for all provider adapters.
 *
 * When live (an `apiKey` and `apiBaseUrl` are configured) each method issues a real,
 * timeout-bounded HTTP call to the provider's env-configured base URL. Until a tenant is
 * wired to a live provider the adapter returns realistic stub shapes so the rest of the
 * meeting lifecycle (join links, dial-in, PIN, recording metadata) can be exercised
 * end-to-end. Concrete providers customise the stub formatting and endpoint paths.
 */
abstract class BaseVCAdapter implements VCAdapter {
  abstract readonly provider: VCProvider;

  protected readonly timeoutMs: number;

  constructor(protected readonly config: VCAdapterConfig) {
    this.timeoutMs = config.timeout ?? DEFAULT_VC_TIMEOUT_MS;
  }

  /** Live mode is enabled once both a base URL and an API key are configured for the tenant. */
  protected isLive(): boolean {
    return this.config.apiBaseUrl.length > 0 && this.config.apiKey.length > 0;
  }

  // Endpoint paths — providers may override to match their real REST surface.
  protected createEndpoint(): string {
    return "/v1/sessions";
  }
  protected sessionEndpoint(externalId: string): string {
    return `/v1/sessions/${encodeURIComponent(externalId)}`;
  }
  protected participantsEndpoint(externalId: string): string {
    return `/v1/sessions/${encodeURIComponent(externalId)}/participants`;
  }
  protected recordingEndpoint(externalId: string): string {
    return `/v1/sessions/${encodeURIComponent(externalId)}/recording`;
  }

  // Stub formatting — providers override to produce platform-shaped values.
  protected abstract stubJoinUrl(externalId: string): string;
  protected stubHostUrl(externalId: string): string | undefined {
    return `${this.stubJoinUrl(externalId)}?role=host`;
  }
  protected stubDialIn(): string | undefined {
    return "+91-11-4000-0000";
  }
  protected stubMeetingPin(): string {
    // Deterministic 9-digit numeric PIN derived from a random uuid — realistic, non-secret stub.
    return String(Math.abs(hashString(randomUUID())) % 1_000_000_000).padStart(9, "0");
  }

  /** Issue a timeout-bounded JSON request to the provider, throwing VCAdapterError on failure. */
  protected async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "application/json",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.config.apiBaseUrl}${path}`, init, this.timeoutMs);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "network error";
      throw new VCAdapterError(`${this.provider} request failed: ${reason}`, this.provider, "VC_TRANSPORT_ERROR");
    }
    if (!res.ok) {
      throw new VCAdapterError(
        `${this.provider} API returned ${res.status}`,
        this.provider,
        "VC_API_ERROR",
        res.status,
      );
    }
    return (await res.json()) as T;
  }

  async createSession(params: CreateSessionParams): Promise<VCSession> {
    if (this.isLive()) {
      const data = await this.request<Record<string, unknown>>("POST", this.createEndpoint(), {
        meetingId: params.meetingId,
        title: params.title,
        scheduledAt: params.scheduledAt.toISOString(),
        durationMinutes: params.durationMinutes,
        hostEmail: params.hostEmail,
        participants: params.participants,
      });
      return this.parseSession(data);
    }
    const externalId = `${this.provider}-${randomUUID()}`;
    return {
      externalId,
      joinUrl: this.stubJoinUrl(externalId),
      dialInNumber: this.stubDialIn(),
      meetingPin: this.stubMeetingPin(),
      hostUrl: this.stubHostUrl(externalId),
    };
  }

  async getJoinLink(externalId: string): Promise<string> {
    if (this.isLive()) {
      const data = await this.request<Record<string, unknown>>("GET", this.sessionEndpoint(externalId));
      const joinUrl = data["joinUrl"];
      if (typeof joinUrl !== "string" || joinUrl.length === 0) {
        throw new VCAdapterError(`${this.provider} returned no join URL`, this.provider, "VC_INVALID_RESPONSE");
      }
      return joinUrl;
    }
    return this.stubJoinUrl(externalId);
  }

  async getParticipants(externalId: string): Promise<VCParticipant[]> {
    if (this.isLive()) {
      const data = await this.request<{ participants?: unknown }>("GET", this.participantsEndpoint(externalId));
      const raw = Array.isArray(data.participants) ? data.participants : [];
      return raw.map((p) => this.parseParticipant(p as Record<string, unknown>));
    }
    // A freshly-created stub session has no live participants yet; VC attendance is recorded
    // via provider webhooks (Req 13.3), not by polling in the stub.
    return [];
  }

  async startRecording(externalId: string): Promise<void> {
    if (this.isLive()) {
      await this.request<unknown>("POST", `${this.recordingEndpoint(externalId)}/start`);
    }
  }

  async stopRecording(externalId: string): Promise<VCRecording> {
    if (this.isLive()) {
      const data = await this.request<Record<string, unknown>>(
        "POST",
        `${this.recordingEndpoint(externalId)}/stop`,
      );
      return this.parseRecording(externalId, data);
    }
    return {
      recordingUrl: `${this.config.apiBaseUrl || `https://vc.${this.provider}.local`}/recordings/${externalId}.mp4`,
      storageKey: `vc-recordings/${this.provider}/${externalId}.mp4`,
      durationSeconds: 0,
      sizeBytes: 0,
    };
  }

  async endSession(externalId: string): Promise<void> {
    if (this.isLive()) {
      await this.request<unknown>("DELETE", this.sessionEndpoint(externalId));
    }
  }

  // ── Response parsers (live mode) ──
  private parseSession(data: Record<string, unknown>): VCSession {
    const externalId = firstString(data["externalId"], data["id"]);
    const joinUrl = firstString(data["joinUrl"], data["join_url"]);
    if (externalId === undefined || joinUrl === undefined) {
      throw new VCAdapterError(`${this.provider} returned an incomplete session`, this.provider, "VC_INVALID_RESPONSE");
    }
    const session: VCSession = { externalId, joinUrl };
    const dialIn = firstString(data["dialInNumber"], data["dial_in_number"]);
    if (dialIn !== undefined) session.dialInNumber = dialIn;
    const pin = firstString(data["meetingPin"], data["meeting_pin"]);
    if (pin !== undefined) session.meetingPin = pin;
    const hostUrl = firstString(data["hostUrl"], data["host_url"]);
    if (hostUrl !== undefined) session.hostUrl = hostUrl;
    return session;
  }

  private parseParticipant(p: Record<string, unknown>): VCParticipant {
    const role = p["role"];
    const participant: VCParticipant = {
      externalUserId: firstString(p["externalUserId"], p["id"]) ?? "",
      displayName: firstString(p["displayName"], p["name"]) ?? "",
      joinedAt: parseDate(p["joinedAt"]) ?? new Date(),
      role: role === "host" || role === "viewer" ? role : "participant",
    };
    const leftAt = parseDate(p["leftAt"]);
    if (leftAt !== undefined) participant.leftAt = leftAt;
    return participant;
  }

  private parseRecording(externalId: string, data: Record<string, unknown>): VCRecording {
    return {
      recordingUrl: firstString(data["recordingUrl"], data["recording_url"]) ?? "",
      storageKey: firstString(data["storageKey"], data["storage_key"]) ?? `vc-recordings/${this.provider}/${externalId}.mp4`,
      durationSeconds: firstNumber(data["durationSeconds"], data["duration_seconds"]) ?? 0,
      sizeBytes: firstNumber(data["sizeBytes"], data["size_bytes"]) ?? 0,
    };
  }
}

// ── Concrete provider adapters ──────────────────────────────────────────────────

/** NIC Video Conferencing — mandatory for government (Req 13.1). */
export class NicVCAdapter extends BaseVCAdapter {
  readonly provider = "nic_vc" as const;
  protected stubJoinUrl(externalId: string): string {
    return `https://vc.nic.in/join/${externalId}`;
  }
  protected override stubDialIn(): string | undefined {
    return "+91-11-2430-0000";
  }
}

/** Microsoft Teams. */
export class TeamsAdapter extends BaseVCAdapter {
  readonly provider = "ms_teams" as const;
  protected stubJoinUrl(externalId: string): string {
    return `https://teams.microsoft.com/l/meetup-join/${externalId}`;
  }
  protected override stubDialIn(): string | undefined {
    return "+91-22-6100-0000";
  }
}

/** Google Meet. */
export class GoogleMeetAdapter extends BaseVCAdapter {
  readonly provider = "google_meet" as const;
  protected stubJoinUrl(externalId: string): string {
    return `https://meet.google.com/${externalId}`;
  }
}

/** Zoom. */
export class ZoomAdapter extends BaseVCAdapter {
  readonly provider = "zoom" as const;
  protected stubJoinUrl(externalId: string): string {
    return `https://zoom.us/j/${externalId}`;
  }
  protected override stubDialIn(): string | undefined {
    return "+91-80-4718-0000";
  }
}

/** Self-hosted WebRTC — always available, anchors the fallback chain (Req 13.1, 13.5). */
export class WebRTCAdapter extends BaseVCAdapter {
  readonly provider = "webrtc" as const;
  protected stubJoinUrl(externalId: string): string {
    const base = this.config.apiBaseUrl || "https://webrtc.meeting.local";
    return `${base}/room/${externalId}`;
  }
  protected override stubDialIn(): string | undefined {
    return undefined; // self-hosted WebRTC has no PSTN dial-in by default
  }
}

// ── Breaker wrapping + factory ───────────────────────────────────────────────────

/** Construct the raw (un-wrapped) provider adapter for a config. */
function buildRawAdapter(config: VCAdapterConfig): VCAdapter {
  switch (config.provider) {
    case "nic_vc":
      return new NicVCAdapter(config);
    case "ms_teams":
      return new TeamsAdapter(config);
    case "google_meet":
      return new GoogleMeetAdapter(config);
    case "zoom":
      return new ZoomAdapter(config);
    case "webrtc":
      return new WebRTCAdapter(config);
    default: {
      // Exhaustiveness guard — unreachable for the VCProvider union.
      const _never: never = config.provider;
      throw new Error(`Unsupported VC provider: ${String(_never)}`);
    }
  }
}

/** Wrap every method of a VCAdapter so each provider call passes through the circuit breaker. */
export function wrapWithBreaker(adapter: VCAdapter, breaker: CircuitBreaker): VCAdapter {
  return {
    provider: adapter.provider,
    createSession: (params) => breaker.call(() => adapter.createSession(params)),
    getJoinLink: (externalId) => breaker.call(() => adapter.getJoinLink(externalId)),
    getParticipants: (externalId) => breaker.call(() => adapter.getParticipants(externalId)),
    startRecording: (externalId) => breaker.call(() => adapter.startRecording(externalId)),
    stopRecording: (externalId) => breaker.call(() => adapter.stopRecording(externalId)),
    endSession: (externalId) => breaker.call(() => adapter.endSession(externalId)),
  };
}

/** Build the circuit breaker for a provider (5 consecutive failures → open for 30s, Req 13.6). */
function buildBreaker(provider: VCProvider): CircuitBreaker {
  return new CircuitBreaker({
    name: `vc-${provider}`,
    failureThreshold: VC_BREAKER_FAILURE_THRESHOLD,
    recoveryMs: VC_BREAKER_RECOVERY_MS,
  });
}

/**
 * Factory: build a single provider adapter wrapped with a circuit breaker (Req 13.6, 13.7).
 * Use {@link createVCFallbackChain} when priority-ordered fallback across providers is required.
 */
export function createVCAdapter(config: VCAdapterConfig): VCAdapter {
  return wrapWithBreaker(buildRawAdapter(config), buildBreaker(config.provider));
}

// ── Fallback chain ───────────────────────────────────────────────────────────────

/** One provider slot in a fallback chain: its breaker-wrapped adapter plus an open-state probe. */
export interface VCChainEntry {
  provider: VCProvider;
  adapter: VCAdapter;
  /** True when this provider's circuit breaker is currently open (calls would be rejected). */
  isOpen: () => boolean;
}

/** Outcome of a fallback createSession attempt. */
export interface VCSessionResult {
  /** The provider that actually served the session (Req 13.5 — persisted as vc_sessions.provider). */
  provider: VCProvider;
  session: VCSession;
  /**
   * The originally-preferred provider when a fallback occurred, else `null`. Non-null values
   * drive the "notify secretary of platform switch" flow (Req 13.5).
   */
  switchedFrom: VCProvider | null;
  /** Every provider tried/skipped before success, for logging and diagnostics. */
  attempts: VCAttempt[];
}

export interface VCFallbackChain {
  /** Configured providers in priority order. */
  readonly providers: readonly VCProvider[];
  /** Create a session, falling through the priority chain on open/failing providers (Req 13.5). */
  createSession(params: CreateSessionParams): Promise<VCSessionResult>;
  /** The breaker-wrapped adapter for a specific provider (for ops on an existing session). */
  adapterFor(provider: VCProvider): VCAdapter | null;
  /** Whether a provider is currently available (configured and breaker not open). */
  isProviderAvailable(provider: VCProvider): boolean;
}

function attemptReason(err: unknown): string {
  if (err instanceof CircuitBreakerOpenError) return "circuit_open";
  if (err instanceof VCAdapterError) return err.code;
  if (err instanceof Error) return err.message;
  return "unknown_error";
}

/**
 * Assemble a fallback chain from pre-built entries. Separated from {@link createVCFallbackChain}
 * so the selection/fallthrough behaviour can be property-tested (P21) with fake adapters and
 * injected `isOpen` probes — no real breakers or network required.
 *
 * The `priority` order defaults to entry order; tenants override it to reorder providers.
 */
export function assembleFallbackChain(
  entries: VCChainEntry[],
  priority?: readonly VCProvider[],
): VCFallbackChain {
  const byProvider = new Map<VCProvider, VCChainEntry>(entries.map((e) => [e.provider, e]));
  const order: readonly VCProvider[] = (priority ?? entries.map((e) => e.provider)).filter((p) =>
    byProvider.has(p),
  );

  return {
    providers: order,

    adapterFor(provider) {
      return byProvider.get(provider)?.adapter ?? null;
    },

    isProviderAvailable(provider) {
      const entry = byProvider.get(provider);
      return entry ? !entry.isOpen() : false;
    },

    async createSession(params) {
      const attempts: VCAttempt[] = [];
      const tried = new Set<VCProvider>();
      const preferred: VCProvider | null = order.length > 0 ? (order[0] as VCProvider) : null;

      for (;;) {
        const remaining = order.filter((p) => !tried.has(p));
        const next = selectFallbackProvider(remaining, (p) => byProvider.get(p)!.isOpen());
        if (next === null) {
          // Everything still standing is open — record those as circuit_open and stop.
          for (const p of remaining) {
            if (!attempts.some((a) => a.provider === p)) {
              attempts.push({ provider: p, reason: "circuit_open" });
            }
          }
          break;
        }

        tried.add(next);
        const entry = byProvider.get(next)!;
        try {
          const session = await entry.adapter.createSession(params);
          return {
            provider: next,
            session,
            switchedFrom: next === preferred ? null : preferred,
            attempts,
          };
        } catch (err) {
          attempts.push({ provider: next, reason: attemptReason(err) });
        }
      }

      throw new VCAllPlatformsUnavailableError(attempts);
    },
  };
}

/**
 * Build a priority-ordered VC fallback chain from provider configs (Req 13.5, 13.6, 13.7).
 *
 * Each provider gets its own breaker-wrapped adapter. The chain tries providers in
 * `priorityOverride` order (falling back to config order, then {@link DEFAULT_PROVIDER_PRIORITY}
 * for any un-ordered providers) and switches to the next provider whenever the active one's
 * breaker is open or its call fails. When all configured providers are exhausted the chain
 * throws {@link VCAllPlatformsUnavailableError}.
 */
export function createVCFallbackChain(
  configs: VCAdapterConfig[],
  priorityOverride?: readonly VCProvider[],
): VCFallbackChain {
  const entries: VCChainEntry[] = configs.map((config) => {
    const breaker = buildBreaker(config.provider);
    return {
      provider: config.provider,
      adapter: wrapWithBreaker(buildRawAdapter(config), breaker),
      isOpen: () => breaker.state === "open",
    };
  });

  const configured = new Set<VCProvider>(configs.map((c) => c.provider));
  const priority =
    priorityOverride ??
    dedupeProviders([...configs.map((c) => c.provider), ...DEFAULT_PROVIDER_PRIORITY]).filter((p) =>
      configured.has(p),
    );

  return assembleFallbackChain(entries, priority);
}

// ── Small pure helpers ─────────────────────────────────────────────────────────

function dedupeProviders(providers: readonly VCProvider[]): VCProvider[] {
  const seen = new Set<VCProvider>();
  const out: VCProvider[] = [];
  for (const p of providers) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function firstNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function parseDate(v: unknown): Date | undefined {
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/** Small deterministic string hash (djb2) used only for non-secret stub PIN generation. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h | 0;
}
