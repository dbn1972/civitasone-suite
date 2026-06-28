/**
 * EOfficeClient — typed HTTP client for the cross-module eOffice integration.
 *
 * Lets any module raise an eFile for formal approval in ~3 lines:
 *
 *   const eOffice = new EOfficeClient({ baseUrl, token });
 *   const file = await eOffice.raiseFile({ refType: "finance_sanction", ... });
 *   // later, status:
 *   const current = await eOffice.getFileByRef("finance_sanction", refId);
 *
 * The approval decision flows back asynchronously on MODULE_CALLBACK_TOPICS —
 * subscribe in your worker and validate with decisionCallbackPayload.
 */
import {
  raiseFileInput,
  acceptedResult,
  fileByRefResult,
  resolvedApproval,
  type RaiseFileInput,
  type AcceptedResult,
  type FileByRef,
  type ResolvedApproval,
  type SourceRefType,
} from "./contracts.js";

export type TokenProvider = string | (() => string | Promise<string>);

export interface EOfficeClientOptions {
  /** Base URL of estab-service, e.g. "http://estab-service:3012" or gateway URL. */
  baseUrl: string;
  /** Bearer token (service account JWT) or a provider that returns one. */
  token: TokenProvider;
  /** Optional tenant id header (X-Tenant-Id) for gateway routing. */
  tenantId?: string;
  /** Optional correlation id forwarded as X-Correlation-Id. */
  correlationId?: string;
  /** Override fetch (for tests / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 10s). */
  timeoutMs?: number;
}

export class EOfficeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "EOfficeError";
  }
}

export interface DecisionLogEntry {
  decision: string;
  callback_topic: string;
  noting_id: string | null;
  dsc_hash: string | null;
  decided_by: string;
  decided_at: string;
}

export class EOfficeClient {
  private readonly baseUrl: string;
  private readonly token: TokenProvider;
  private readonly tenantId: string | undefined;
  private readonly correlationId: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: EOfficeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.tenantId = opts.tenantId;
    this.correlationId = opts.correlationId;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new Error("EOfficeClient: no fetch available; pass fetchImpl");
    }
    this.fetchImpl = f;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /**
   * Raise an eFile for formal, auditable approval. Returns the file id + file
   * number immediately (202 Accepted); the decision arrives later on the
   * module's callback topic.
   */
  async raiseFile(input: RaiseFileInput): Promise<AcceptedResult> {
    const body = raiseFileInput.parse(input);
    const json = await this.request("POST", "/v1/estab/files/from-module", body);
    return acceptedResult.parse(json);
  }

  /**
   * Fetch the latest eFile raised for a given business entity. Returns null if
   * no file exists yet.
   */
  async getFileByRef(refType: SourceRefType, refId: string): Promise<FileByRef | null> {
    const qs = new URLSearchParams({ refType, refId });
    try {
      const json = await this.request("GET", `/v1/estab/files/by-ref?${qs.toString()}`);
      const env = json as { data?: unknown };
      return fileByRefResult.parse(env.data);
    } catch (err) {
      if (err instanceof EOfficeError && err.status === 404) return null;
      throw err;
    }
  }

  /** Read the decision callback log for a file (audit / observability). */
  async getDecisionLog(fileId: string): Promise<DecisionLogEntry[]> {
    const json = await this.request("GET", `/v1/estab/files/${encodeURIComponent(fileId)}/decision-log`);
    const env = json as { data?: DecisionLogEntry[] };
    return env.data ?? [];
  }

  /**
   * Preview which approval chain the amount-band matrix would apply for a
   * (sourceType, amount). Returns null when no rule matches (the caller must
   * supply an explicit approvalChain when raising the file).
   */
  async resolveApprovalChain(refType: SourceRefType, amountMinor: number): Promise<ResolvedApproval | null> {
    const qs = new URLSearchParams({ sourceType: refType, amountMinor: String(amountMinor) });
    const json = await this.request("GET", `/v1/estab/approval-rules/resolve?${qs.toString()}`);
    const env = json as { data?: unknown };
    if (env.data == null) return null;
    return resolvedApproval.parse(env.data);
  }

  private async resolveToken(): Promise<string> {
    return typeof this.token === "function" ? await this.token() : this.token;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.resolveToken();
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.tenantId) headers["x-tenant-id"] = this.tenantId;
    if (this.correlationId) headers["x-correlation-id"] = this.correlationId;

    const controller = new AbortController();
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) init.body = JSON.stringify(body);

    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed: unknown = text ? safeJson(text) : undefined;

    if (!res.ok) {
      const e = (parsed ?? {}) as { code?: string; message?: string; correlationId?: string };
      throw new EOfficeError(
        res.status,
        e.code ?? "HTTP_ERROR",
        e.message ?? `eOffice request failed (${res.status})`,
        e.correlationId,
      );
    }
    return parsed;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
