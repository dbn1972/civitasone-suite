/**
 * PFMS Treasury Gateway Client — payment advice, payment status, salary
 * bill, and treasury balance operations against India's PFMS (Public
 * Financial Management System) government treasury rail.
 *
 * This is a DIFFERENT PFMS surface from ./adapter.ts (which talks to the
 * e-Kuber generic payment rail via PFMS_ENABLED / PFMS_BASE_URL /
 * PFMS_API_KEY). Treasury advice / salary-bill / balance operations use
 * their own PFMS_TREASURY_* env vars below so the two integrations can be
 * configured, enabled, and rotated independently.
 *
 * Config-driven dual mode (same fail-closed philosophy as ./adapter.ts, but
 * sandbox mode here returns a usable synthetic response instead of a 503,
 * so finance officers and downstream flows keep working end-to-end in
 * dev/test):
 *
 *  - SANDBOX (the default, and the only mode this environment has ever run
 *    in — there are no real NIC PFMS credentials or a DSC available here):
 *    PFMS_TREASURY_BASE_URL or PFMS_TREASURY_API_KEY absent → every
 *    operation returns a synthetic response. `mode: "sandbox"` is stamped
 *    on every response, and every synthetic government-facing reference
 *    (pfmsRef / pfmsBillNo / pfmsTransactionId / utrNumber) is prefixed
 *    `SANDBOX-` so it can never be mistaken for a real PFMS reference, even
 *    from raw stored data with no other context. Nothing here ever touches
 *    a real government system in this mode.
 *
 *  - LIVE: both PFMS_TREASURY_BASE_URL and PFMS_TREASURY_API_KEY configured
 *    → real HTTP calls are attempted against the configured NIC PFMS
 *    endpoint. `mode: "live"` is stamped on every response. A live-mode
 *    failure (network error, non-2xx response, missing DSC config for a
 *    submission) throws a structured PfmsTreasuryError — it never falls
 *    back to a sandbox-looking success.
 *
 * Going live later is a pure configuration change: set the four
 * PFMS_TREASURY_* env vars documented in .env.example. No code change is
 * required to switch modes.
 *
 * NOTE ON DSC SIGNING (signRequest, below): the real NIC PFMS API contract
 * for request signing — canonicalization rules, PKCS#7/CMS vs. raw
 * signature, header names, etc. — is not available in this environment;
 * there is no NIC PFMS sandbox or API documentation to validate against
 * here. signRequest() is a best-effort implementation using only Node's
 * built-in `crypto` module and MUST be validated against the real NIC PFMS
 * integration docs / sandbox before any live submission is trusted. Treat
 * it as UNVERIFIED — see the function's doc comment for specifics.
 */

import { readFile } from "node:fs/promises";
import { createPrivateKey, createSign, randomUUID } from "node:crypto";
import { pino } from "pino";

const log = pino({ name: "finance:pfms-treasury-client" });

const TIMEOUT_MS = 15_000; // matches ./adapter.ts's requirement-22.4 timeout

// ── Config ────────────────────────────────────────────────────────

export interface PfmsTreasuryConfig {
  baseUrl: string;
  apiKey: string;
  certPath: string | undefined;
  certPassphrase: string | undefined;
  mode: "sandbox" | "live";
}

function resolveConfig(): PfmsTreasuryConfig {
  const baseUrl = process.env["PFMS_TREASURY_BASE_URL"] ?? "";
  const apiKey = process.env["PFMS_TREASURY_API_KEY"] ?? "";
  const certPath = process.env["PFMS_TREASURY_DSC_CERT_PATH"] || undefined;
  const certPassphrase = process.env["PFMS_TREASURY_DSC_CERT_PASSPHRASE"] || undefined;
  // Fail-closed toward sandbox: BOTH base URL and API key must be present to
  // go live. A half-configured environment (only one of the two set) stays
  // in sandbox rather than attempting a call against a garbage endpoint.
  const mode: "sandbox" | "live" = baseUrl.length > 0 && apiKey.length > 0 ? "live" : "sandbox";
  return { baseUrl, apiKey, certPath, certPassphrase, mode };
}

/** Active mode, without exposing credentials — safe for health checks / UI banners. */
export function getPfmsTreasuryMode(): "sandbox" | "live" {
  return resolveConfig().mode;
}

// ── Errors ────────────────────────────────────────────────────────

export class PfmsTreasuryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PfmsTreasuryError";
  }
}

// ── Redaction helpers ─────────────────────────────────────────────
// No PII or secrets in logs — house convention, see ./adapter-routes.ts
// ("No PII in logs — only correlation IDs, adapter name, and status codes")
// and tests/gov-rail-pfms.test.ts's "no PII in error responses" suite.
// The DSC passphrase and raw certificate content are NEVER passed to log().

function maskAccountNo(acct: string): string {
  return acct.length <= 4 ? "****" : `****${acct.slice(-4)}`;
}

function logSubmission(op: string, mode: "sandbox" | "live", summary: Record<string, unknown>): void {
  log.info({ op, mode, at: new Date().toISOString(), ...summary }, `PFMS treasury ${op} (${mode})`);
}

// ── DSC signing (UNVERIFIED — see file header) ──────────────────────

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Sign a payload with the configured DSC certificate, approximating the NIC
 * PFMS PKCS7/X.509 request-signing flow.
 *
 * UNVERIFIED — see file header. Specifically:
 *  - Produces a detached RSA-SHA256 signature (base64) over the
 *    canonicalized JSON payload, using Node's built-in `crypto` module only.
 *  - Node's built-in `crypto` has no native PKCS#7/CMS support. If the real
 *    NIC contract requires a full PKCS#7 enveloped/detached signature
 *    (common for DSC-based government signing flows) rather than a raw RSA
 *    signature, this will need a PKCS#7 library (e.g. node-forge, pkijs) or
 *    an `openssl smime -sign` shell-out instead.
 *  - Assumes `certPath` is a PEM file containing (or accompanying) an RSA
 *    private key decryptable with `passphrase`. Indian DSC tokens are
 *    frequently issued as PKCS#12 (.pfx/.p12) — Node's `crypto` module
 *    cannot parse those directly; they would need converting to PEM first
 *    (e.g. `openssl pkcs12 -in cert.pfx -out cert.pem -nodes`) or a
 *    PKCS#12-aware library.
 *  - The exact canonicalization algorithm, signature encoding, and header
 *    placement NIC expects are not confirmed against any real API docs.
 *
 * Do not treat this as validated against a production or sandbox NIC
 * endpoint — it has never been run against one.
 */
export async function signRequest(
  payload: unknown,
  certPath: string,
  passphrase: string,
): Promise<string> {
  let pem: string;
  try {
    pem = await readFile(certPath, "utf8");
  } catch (err) {
    throw new PfmsTreasuryError(
      `Unable to read DSC certificate file at ${certPath}: ${(err as Error).message}`,
      "SIGNING_FAILED",
    );
  }

  try {
    const privateKey = createPrivateKey({ key: pem, passphrase });
    const signer = createSign("RSA-SHA256");
    signer.update(canonicalJson(payload));
    signer.end();
    return signer.sign(privateKey, "base64");
  } catch (err) {
    throw new PfmsTreasuryError(`DSC signing failed: ${(err as Error).message}`, "SIGNING_FAILED");
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with exactly one retry on network-level failure (DNS, connection
 * refused, timeout/abort). A response that comes back with a non-2xx status
 * is NOT a network-level failure — it is returned as-is for the caller to
 * translate into a PfmsTreasuryError; it is never retried here.
 */
async function fetchWithOneRetry(url: string, init: RequestInit, op: string): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init);
  } catch (firstErr) {
    log.warn(
      { op, mode: "live", err: (firstErr as Error).message },
      "PFMS treasury live call failed at network level — retrying once",
    );
    try {
      return await fetchWithTimeout(url, init);
    } catch (secondErr) {
      throw new PfmsTreasuryError(
        `PFMS network error after 1 retry: ${(secondErr as Error).message}`,
        "NETWORK_ERROR",
      );
    }
  }
}

function authHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...extra,
  };
}

async function assertOk(res: Response, op: string): Promise<void> {
  if (res.ok) return;
  log.error({ op, mode: "live", httpStatus: res.status }, "PFMS treasury live call returned a business error");
  throw new PfmsTreasuryError(`PFMS treasury API returned ${res.status}`, "PFMS_API_ERROR", res.status);
}

/** Requires DSC cert config for a live submission; throws a structured, fail-closed error if missing. */
function requireSigningConfig(cfg: PfmsTreasuryConfig, op: string): { certPath: string; certPassphrase: string } {
  if (!cfg.certPath || !cfg.certPassphrase) {
    throw new PfmsTreasuryError(
      `PFMS is in live mode but PFMS_TREASURY_DSC_CERT_PATH / PFMS_TREASURY_DSC_CERT_PASSPHRASE are not configured — refusing to submit ${op} unsigned`,
      "DSC_CONFIG_MISSING",
    );
  }
  return { certPath: cfg.certPath, certPassphrase: cfg.certPassphrase };
}

// ── Operation input/output types ─────────────────────────────────

export interface PaymentAdviceInput {
  billId: string;
  payeeName: string;
  payeeAccountNo: string;
  payeeIfsc: string;
  amountMinor: number;
  purposeCode: string;
  ddoCode?: string | undefined;
  schemeCode?: string | undefined;
  remarks?: string | undefined;
}

export interface PaymentAdviceResult {
  adviceId: string;
  pfmsRef: string;
  billId: string;
  amountMinor: number;
  status: string;
  submittedAt: string;
  message: string;
  mode: "sandbox" | "live";
}

export interface PaymentStatusResult {
  adviceId: string;
  status: string;
  pfmsTransactionId: string;
  processedAt: string;
  utrNumber: string;
  message: string;
  mode: "sandbox" | "live";
}

export interface SalaryBillInput {
  month: string;
  departmentId: string;
  totalAmountMinor: number;
  employeeCount: number;
  ddoCode: string;
  schemeCode?: string | undefined;
  remarks?: string | undefined;
}

export interface SalaryBillResult {
  billRef: string;
  pfmsBillNo: string;
  month: string;
  departmentId: string;
  totalAmountMinor: number;
  employeeCount: number;
  status: string;
  submittedAt: string;
  message: string;
  mode: "sandbox" | "live";
}

export interface TreasuryBalanceAccount {
  accountType: string;
  balanceMinor: string;
  bankName: string;
}

export interface TreasuryBalanceResult {
  tenantId: string;
  balanceMinor: string;
  currency: string;
  asOf: string;
  accounts: TreasuryBalanceAccount[];
  message: string;
  mode: "sandbox" | "live";
}

// ── Public API ────────────────────────────────────────────────────

/** Submit a payment advice to treasury. DSC-signed when live. */
export async function submitPaymentAdvice(input: PaymentAdviceInput): Promise<PaymentAdviceResult> {
  const cfg = resolveConfig();
  const adviceId = randomUUID();

  if (cfg.mode === "sandbox") {
    const pfmsRef = `SANDBOX-ADV-${Date.now()}-${adviceId.slice(0, 8).toUpperCase()}`;
    const result: PaymentAdviceResult = {
      adviceId,
      pfmsRef,
      billId: input.billId,
      amountMinor: input.amountMinor,
      status: "submitted",
      submittedAt: new Date().toISOString(),
      message:
        "SANDBOX MODE: no PFMS_TREASURY credentials configured — this is a simulated response, not a real treasury submission.",
      mode: "sandbox",
    };
    logSubmission("submitPaymentAdvice", "sandbox", {
      billId: input.billId,
      amountMinor: input.amountMinor,
      payeeAccountNo: maskAccountNo(input.payeeAccountNo),
    });
    return result;
  }

  const { certPath, certPassphrase } = requireSigningConfig(cfg, "payment advice");
  const payload = {
    billId: input.billId,
    payeeName: input.payeeName,
    payeeAccountNo: input.payeeAccountNo,
    payeeIfsc: input.payeeIfsc,
    amountMinor: input.amountMinor,
    purposeCode: input.purposeCode,
    ddoCode: input.ddoCode,
    schemeCode: input.schemeCode,
    remarks: input.remarks,
  };
  // UNVERIFIED signature — see signRequest() doc comment.
  const signature = await signRequest(payload, certPath, certPassphrase);

  // NOT retried: this is a non-idempotent financial submission with no
  // idempotency key in the payload. A timeout/abort here is ambiguous —
  // PFMS may have already accepted it — so retrying could double-submit
  // a real payment advice. Surface the failure and let a human check
  // status (getPaymentStatus) before deciding whether to resubmit.
  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/api/v1/payment-advice`, // placeholder path — confirm against real NIC PFMS API docs
    {
      method: "POST",
      headers: authHeaders(cfg.apiKey, { "X-DSC-Signature": signature }),
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, "submitPaymentAdvice");

  const data = (await res.json()) as Partial<{
    adviceId: string;
    pfmsRef: string;
    status: string;
    submittedAt: string;
    message: string;
  }>;

  const result: PaymentAdviceResult = {
    adviceId: data.adviceId ?? adviceId,
    pfmsRef: data.pfmsRef ?? "",
    billId: input.billId,
    amountMinor: input.amountMinor,
    status: data.status ?? "submitted",
    submittedAt: data.submittedAt ?? new Date().toISOString(),
    message: data.message ?? "Submitted to PFMS live treasury gateway.",
    mode: "live",
  };
  logSubmission("submitPaymentAdvice", "live", {
    billId: input.billId,
    amountMinor: input.amountMinor,
    payeeAccountNo: maskAccountNo(input.payeeAccountNo),
  });
  return result;
}

/** Look up payment advice status by advice ID. Read-only — not DSC-signed. */
export async function getPaymentStatus(adviceId: string): Promise<PaymentStatusResult> {
  const cfg = resolveConfig();

  if (cfg.mode === "sandbox") {
    const result: PaymentStatusResult = {
      adviceId,
      status: "processed",
      pfmsTransactionId: `SANDBOX-TXN-${adviceId.slice(0, 12).toUpperCase()}`,
      processedAt: new Date().toISOString(),
      utrNumber: `SANDBOX-UTR${Date.now()}`,
      message:
        "SANDBOX MODE: no PFMS_TREASURY credentials configured — this is a simulated response, not a real treasury status.",
      mode: "sandbox",
    };
    logSubmission("getPaymentStatus", "sandbox", { adviceId });
    return result;
  }

  const res = await fetchWithOneRetry(
    `${cfg.baseUrl}/api/v1/payment-advice/${encodeURIComponent(adviceId)}/status`, // placeholder path
    { method: "GET", headers: authHeaders(cfg.apiKey) },
    "getPaymentStatus",
  );
  await assertOk(res, "getPaymentStatus");

  const data = (await res.json()) as Partial<{
    status: string;
    pfmsTransactionId: string;
    processedAt: string;
    utrNumber: string;
    message: string;
  }>;

  const result: PaymentStatusResult = {
    adviceId,
    status: data.status ?? "processing",
    pfmsTransactionId: data.pfmsTransactionId ?? "",
    processedAt: data.processedAt ?? new Date().toISOString(),
    utrNumber: data.utrNumber ?? "",
    message: data.message ?? "Live status from PFMS treasury gateway.",
    mode: "live",
  };
  logSubmission("getPaymentStatus", "live", { adviceId });
  return result;
}

/** Submit a salary bill to treasury. DSC-signed when live. */
export async function submitSalaryBill(input: SalaryBillInput): Promise<SalaryBillResult> {
  const cfg = resolveConfig();
  const billRef = randomUUID();

  if (cfg.mode === "sandbox") {
    const pfmsBillNo = `SANDBOX-SAL-${input.month}-${input.ddoCode}-${billRef.slice(0, 6).toUpperCase()}`;
    const result: SalaryBillResult = {
      billRef,
      pfmsBillNo,
      month: input.month,
      departmentId: input.departmentId,
      totalAmountMinor: input.totalAmountMinor,
      employeeCount: input.employeeCount,
      status: "submitted_to_treasury",
      submittedAt: new Date().toISOString(),
      message:
        "SANDBOX MODE: no PFMS_TREASURY credentials configured — this is a simulated response, not a real treasury submission.",
      mode: "sandbox",
    };
    logSubmission("submitSalaryBill", "sandbox", {
      month: input.month,
      departmentId: input.departmentId,
      totalAmountMinor: input.totalAmountMinor,
      employeeCount: input.employeeCount,
    });
    return result;
  }

  const { certPath, certPassphrase } = requireSigningConfig(cfg, "salary bill");
  const payload = {
    month: input.month,
    departmentId: input.departmentId,
    totalAmountMinor: input.totalAmountMinor,
    employeeCount: input.employeeCount,
    ddoCode: input.ddoCode,
    schemeCode: input.schemeCode,
    remarks: input.remarks,
  };
  const signature = await signRequest(payload, certPath, certPassphrase);

  // NOT retried — same non-idempotency reasoning as submitPaymentAdvice
  // above: a real salary bill must never be silently double-submitted.
  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/api/v1/salary-bill`, // placeholder path — confirm against real NIC PFMS API docs
    {
      method: "POST",
      headers: authHeaders(cfg.apiKey, { "X-DSC-Signature": signature }),
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, "submitSalaryBill");

  const data = (await res.json()) as Partial<{
    billRef: string;
    pfmsBillNo: string;
    status: string;
    submittedAt: string;
    message: string;
  }>;

  const result: SalaryBillResult = {
    billRef: data.billRef ?? billRef,
    pfmsBillNo: data.pfmsBillNo ?? "",
    month: input.month,
    departmentId: input.departmentId,
    totalAmountMinor: input.totalAmountMinor,
    employeeCount: input.employeeCount,
    status: data.status ?? "submitted_to_treasury",
    submittedAt: data.submittedAt ?? new Date().toISOString(),
    message: data.message ?? "Submitted to PFMS live treasury gateway.",
    mode: "live",
  };
  logSubmission("submitSalaryBill", "live", {
    month: input.month,
    departmentId: input.departmentId,
    totalAmountMinor: input.totalAmountMinor,
    employeeCount: input.employeeCount,
  });
  return result;
}

/** Fetch treasury balance for a tenant. Read-only — not DSC-signed. */
export async function getTreasuryBalance(tenantId: string): Promise<TreasuryBalanceResult> {
  const cfg = resolveConfig();

  if (cfg.mode === "sandbox") {
    const result: TreasuryBalanceResult = {
      tenantId,
      balanceMinor: "500000000000",
      currency: "INR",
      asOf: new Date().toISOString(),
      accounts: [
        { accountType: "treasury", balanceMinor: "400000000000", bankName: "RBI" },
        { accountType: "assignment", balanceMinor: "100000000000", bankName: "SBI" },
      ],
      message:
        "SANDBOX MODE: no PFMS_TREASURY credentials configured — this is a simulated balance, not a real treasury balance.",
      mode: "sandbox",
    };
    logSubmission("getTreasuryBalance", "sandbox", { tenantId });
    return result;
  }

  const res = await fetchWithOneRetry(
    `${cfg.baseUrl}/api/v1/treasury/balance?tenantId=${encodeURIComponent(tenantId)}`, // placeholder path
    { method: "GET", headers: authHeaders(cfg.apiKey) },
    "getTreasuryBalance",
  );
  await assertOk(res, "getTreasuryBalance");

  const data = (await res.json()) as Partial<{
    balanceMinor: string;
    currency: string;
    asOf: string;
    accounts: TreasuryBalanceAccount[];
    message: string;
  }>;

  const result: TreasuryBalanceResult = {
    tenantId,
    balanceMinor: data.balanceMinor ?? "0",
    currency: data.currency ?? "INR",
    asOf: data.asOf ?? new Date().toISOString(),
    accounts: data.accounts ?? [],
    message: data.message ?? "Live balance from PFMS treasury gateway.",
    mode: "live",
  };
  logSubmission("getTreasuryBalance", "live", { tenantId });
  return result;
}
