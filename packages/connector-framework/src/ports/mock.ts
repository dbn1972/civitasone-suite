/**
 * Sandbox MOCK adapters. Stateless and deterministic: ids embed the creation
 * time, so verify()/fetchStatus() can derive a realistic lifecycle
 * (pending -> signed, received -> processing -> processed) without storage.
 * The "sandboxScenario" config value lets a tester force a failure path.
 * Nothing here talks to a network.
 */
import {
  fnv1a,
  readScenario,
  type AdapterContext,
  type ConnectionTestResult,
  type SandboxScenario,
} from "./types.js";
import type {
  EsignInitiateRequest,
  EsignInitiateResult,
  EsignProvider,
  EsignVerifyRequest,
  EsignVerifyResult,
} from "./esign.js";
import type { DscSignRequest, DscSignResult, DscSigner } from "./dsc.js";
import type {
  BankApi,
  FetchStatusRequest,
  FetchStatusResult,
  SubmitPaymentFileRequest,
  SubmitPaymentFileResult,
} from "./bank.js";

export class AdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

export interface MockOptions {
  /** Injectable clock (ms epoch) so lifecycle transitions are testable. */
  now?: () => number;
}

const ESIGN_SIGN_AFTER_MS = 3_000;
const ESIGN_EXPIRES_AFTER_MS = 10 * 60_000;
const BANK_PROCESSING_AFTER_MS = 5_000;
const BANK_PROCESSED_AFTER_MS = 15_000;

function clock(o: MockOptions | undefined): () => number {
  return o?.now ?? (() => Date.now());
}

function scenarioResult(s: SandboxScenario, providerName: string, latencyMs: number): ConnectionTestResult {
  switch (s) {
    case "auth_failed":
      return { ok: false, code: "AUTH_FAILED", message: `${providerName} sandbox rejected the credentials (mock).`, latencyMs, mock: true };
    case "timeout":
      return { ok: false, code: "TIMEOUT", message: `${providerName} sandbox did not respond within 10s (mock).`, latencyMs: 10_000, mock: true };
    case "provider_rejected":
      return { ok: false, code: "PROVIDER_REJECTED", message: `${providerName} sandbox returned HTTP 503 (mock).`, latencyMs, mock: true };
    default:
      return { ok: true, code: "OK", message: `${providerName} sandbox handshake succeeded (mock).`, latencyMs, mock: true };
  }
}

function latencyFor(ctx: AdapterContext): number {
  return 80 + (parseInt(fnv1a(ctx.providerKey), 16) % 120);
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

export class MockEsignProvider implements EsignProvider {
  readonly mock = true;
  readonly providerKey: string;
  private readonly now: () => number;
  constructor(private readonly ctx: AdapterContext, opts?: MockOptions) {
    this.providerKey = ctx.providerKey;
    this.now = clock(opts);
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return scenarioResult(readScenario(this.ctx.config), this.ctx.providerName, latencyFor(this.ctx));
  }
  async initiate(req: EsignInitiateRequest): Promise<EsignInitiateResult> {
    if (!HEX64.test(req.documentHashSha256)) {
      throw new AdapterError("INVALID_HASH", "documentHashSha256 must be a 64-char hex SHA-256");
    }
    if (readScenario(this.ctx.config) === "auth_failed") {
      throw new AdapterError("AUTH_FAILED", `${this.ctx.providerName} sandbox rejected the credentials (mock).`);
    }
    const t = this.now();
    const transactionId = `MOCKESIGN-${t.toString(36)}-${fnv1a(`${req.documentId}|${req.signerRef}|${req.documentHashSha256}`)}`;
    return {
      transactionId,
      redirectUrl: `https://sandbox.invalid/esign/${transactionId}`,
      expiresAt: new Date(t + ESIGN_EXPIRES_AFTER_MS).toISOString(),
    };
  }
  async verify(req: EsignVerifyRequest): Promise<EsignVerifyResult> {
    const m = /^MOCKESIGN-([0-9a-z]+)-([0-9a-f]{8})$/.exec(req.transactionId);
    if (!m || !m[1] || !m[2]) throw new AdapterError("UNKNOWN_TRANSACTION", `unknown eSign transaction '${req.transactionId}'`);
    const created = parseInt(m[1], 36);
    const elapsed = this.now() - created;
    const scenario = readScenario(this.ctx.config);
    if (scenario === "provider_rejected") {
      return { transactionId: req.transactionId, status: "failed", failureReason: "Signer declined the request (mock)." };
    }
    if (scenario === "timeout" || elapsed >= ESIGN_EXPIRES_AFTER_MS) {
      return { transactionId: req.transactionId, status: "expired", failureReason: "Signing window elapsed (mock)." };
    }
    if (elapsed < ESIGN_SIGN_AFTER_MS) return { transactionId: req.transactionId, status: "pending" };
    return {
      transactionId: req.transactionId,
      status: "signed",
      signedAt: new Date(created + ESIGN_SIGN_AFTER_MS).toISOString(),
      certificateSerial: `MOCK-${m[2].toUpperCase()}`,
    };
  }
}

export class MockDscSigner implements DscSigner {
  readonly mock = true;
  readonly providerKey: string;
  private readonly now: () => number;
  constructor(private readonly ctx: AdapterContext, opts?: MockOptions) {
    this.providerKey = ctx.providerKey;
    this.now = clock(opts);
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return scenarioResult(readScenario(this.ctx.config), this.ctx.providerName, latencyFor(this.ctx));
  }
  async sign(req: DscSignRequest): Promise<DscSignResult> {
    if (!HEX64.test(req.payloadHashSha256)) {
      throw new AdapterError("INVALID_HASH", "payloadHashSha256 must be a 64-char hex SHA-256");
    }
    const scenario = readScenario(this.ctx.config);
    if (scenario === "auth_failed") throw new AdapterError("AUTH_FAILED", "Token PIN rejected (mock).");
    if (scenario === "timeout") throw new AdapterError("TIMEOUT", "Signer bridge did not respond (mock).");
    if (scenario === "provider_rejected") throw new AdapterError("PROVIDER_REJECTED", "Signer refused the request (mock).");
    // NOT a cryptographic signature: a clearly-labelled deterministic placeholder.
    const body = `MOCK-DSC|${req.signerRef}|${req.payloadHashSha256.toLowerCase()}|${fnv1a(req.reason)}`;
    return {
      signatureBase64: btoa(body),
      algorithm: "MOCK-SHA256withRSA",
      certificateSerial: `MOCK-${fnv1a(req.signerRef).toUpperCase()}`,
      signedAt: new Date(this.now()).toISOString(),
    };
  }
}

export class MockBankApi implements BankApi {
  readonly mock = true;
  readonly providerKey: string;
  private readonly now: () => number;
  constructor(private readonly ctx: AdapterContext, opts?: MockOptions) {
    this.providerKey = ctx.providerKey;
    this.now = clock(opts);
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return scenarioResult(readScenario(this.ctx.config), this.ctx.providerName, latencyFor(this.ctx));
  }
  async submitPaymentFile(req: SubmitPaymentFileRequest): Promise<SubmitPaymentFileResult> {
    if (req.recordCount <= 0 || req.totalAmountMinor <= 0n) {
      throw new AdapterError("EMPTY_BATCH", "payment file must contain at least one record with a positive total");
    }
    const scenario = readScenario(this.ctx.config);
    if (scenario === "auth_failed") {
      throw new AdapterError("AUTH_FAILED", `${this.ctx.providerName} sandbox rejected the credentials (mock).`);
    }
    const t = this.now();
    const submissionId = `MOCKSUB-${t.toString(36)}-${fnv1a(`${req.fileName}|${req.fileHashSha256}`)}`;
    if (scenario === "provider_rejected") {
      return { submissionId, accepted: false, receivedAt: new Date(t).toISOString(), rejectionReason: "File failed bank-side validation (mock)." };
    }
    return { submissionId, accepted: true, receivedAt: new Date(t).toISOString() };
  }
  async fetchStatus(req: FetchStatusRequest): Promise<FetchStatusResult> {
    const m = /^MOCKSUB-([0-9a-z]+)-([0-9a-f]{8})$/.exec(req.submissionId);
    if (!m || !m[1]) throw new AdapterError("UNKNOWN_SUBMISSION", `unknown submission '${req.submissionId}'`);
    const elapsed = this.now() - parseInt(m[1], 36);
    if (readScenario(this.ctx.config) === "provider_rejected") {
      return { submissionId: req.submissionId, status: "rejected", processedCount: 0, failedCount: 0, reason: "File failed bank-side validation (mock)." };
    }
    if (elapsed < BANK_PROCESSING_AFTER_MS) return { submissionId: req.submissionId, status: "received", processedCount: 0, failedCount: 0 };
    if (elapsed < BANK_PROCESSED_AFTER_MS) return { submissionId: req.submissionId, status: "processing", processedCount: 0, failedCount: 0 };
    return { submissionId: req.submissionId, status: "processed", processedCount: 1, failedCount: 0 };
  }
}

/** PFMS has no dedicated port yet: sandbox support is connection-test only. */
export class MockGenericAdapter implements IntegrationAdapterLike {
  readonly mock = true;
  readonly providerKey: string;
  constructor(private readonly ctx: AdapterContext) {
    this.providerKey = ctx.providerKey;
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return scenarioResult(readScenario(this.ctx.config), this.ctx.providerName, latencyFor(this.ctx));
  }
}

type IntegrationAdapterLike = import("./types.js").IntegrationAdapter;
