/**
 * HTTP client for the link-target services' internal lookup routes (GET /internal/v1/scan-link/lookup).
 *
 * Service-to-service auth = x-internal + x-tenant-id + x-service-secret (INTERNAL_SERVICE_SECRET), the platform's
 * internal path. Per-target-service circuit breaker + hard timeout. It is NEVER called inside a DB transaction and
 * NEVER throws for an unavailable target: callers get `{ data: [], error }` so a down hrms/finance/estab service
 * degrades the review screen (no suggestions) instead of breaking it.
 */
import { CircuitBreaker } from "@civitasone/circuit-breaker";
import { TARGET_SERVICE, lookupResponseSchema, type LinkTarget, type LinkService, type LookupCandidate } from "@civitasone/scan-link";
import { pino } from "pino";
import { errMessage } from "./scrub.js";

const log = pino({ name: "bulk-scan-lookup", level: process.env.LOG_LEVEL ?? "info" });

const DEFAULT_PORT: Record<LinkService, number> = { hrms: 3012, finance: 3007, estab: 3010 };
const ENV_URL: Record<LinkService, string> = { hrms: "HRMS_SERVICE_URL", finance: "FINANCE_SERVICE_URL", estab: "ESTAB_SERVICE_URL" };
const baseUrl = (s: LinkService): string => process.env[ENV_URL[s]] ?? `http://127.0.0.1:${DEFAULT_PORT[s]}`;
const timeoutMs = (): number => Number(process.env.BULK_SCAN_LOOKUP_TIMEOUT_MS ?? 4000);

const breakers = new Map<string, CircuitBreaker>();
function breakerFor(s: string): CircuitBreaker {
  let b = breakers.get(s);
  if (!b) {
    b = new CircuitBreaker({ name: "bulk-scan-lookup-" + s, failureThreshold: Number(process.env.BULK_SCAN_LOOKUP_BREAKER_FAILURES ?? 5), recoveryMs: Number(process.env.BULK_SCAN_LOOKUP_BREAKER_RECOVERY_MS ?? 15_000) });
    breakers.set(s, b);
  }
  return b;
}
/** Test seam. */
export function resetLookupBreakers(): void { breakers.clear(); }

export interface LookupArgs { target: LinkTarget; q: string; amountMinor?: string | undefined }
export interface LookupResult { data: LookupCandidate[]; error?: { code: "TARGET_UNAVAILABLE" | "LOOKUP_NOT_CONFIGURED"; target: LinkTarget } }

/** Query string per target service (each service owns its own parameter names). */
export function lookupQueryFor(a: LookupArgs): URLSearchParams {
  const p = new URLSearchParams();
  switch (a.target) {
    case "hr_employee":
      p.set("employeeNo", a.q.slice(0, 64));
      if (a.q.length >= 2) p.set("name", a.q.slice(0, 120));
      break;
    case "eoffice_file":
      p.set("fileNo", a.q.slice(0, 100));
      p.set("subject", a.q.slice(0, 300));
      break;
    default:
      p.set("reference", a.q.slice(0, 100));
      if (a.amountMinor) p.set("amountMinor", a.amountMinor);
      p.set("kind", a.target);
  }
  return p;
}

export async function lookupTarget(ctx: { tenantId: string; correlationId: string }, a: LookupArgs): Promise<LookupResult> {
  const svc = TARGET_SERVICE[a.target];
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return { data: [], error: { code: "LOOKUP_NOT_CONFIGURED", target: a.target } };
  try {
    const data = await breakerFor(svc).call(async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs());
      try {
        const res = await fetch(`${baseUrl(svc)}/internal/v1/scan-link/lookup?${lookupQueryFor(a).toString()}`, {
          headers: { "x-internal": "1", "x-tenant-id": ctx.tenantId, "x-service-secret": secret, "x-internal-caller": "document-service", "x-correlation-id": ctx.correlationId },
          signal: ac.signal,
        });
        if (res.status >= 500) throw new Error("target answered " + res.status);   // counts against the breaker
        if (!res.ok) return [] as LookupCandidate[];                                // 4xx: no candidates (not a target outage)
        const parsed = lookupResponseSchema.safeParse(await res.json());
        if (!parsed.success) throw new Error("target answered an unexpected shape");
        return parsed.data.data;
      } finally {
        clearTimeout(timer);
      }
    });
    return { data: data.filter((d) => d.target === a.target) };
  } catch (e) {
    log.warn({ target: a.target, err: errMessage(e) }, "bulk-scan: target lookup unavailable");
    return { data: [], error: { code: "TARGET_UNAVAILABLE", target: a.target } };
  }
}

export interface Suggestion { target: LinkTarget; targetId: string; label: string; confidence: number; amountMinor?: string; reference?: string; mismatch?: boolean }

interface SuggestionField { kind: string; value: string; confidence?: number }
const bestField = (fs: readonly SuggestionField[], kind: string): SuggestionField | undefined =>
  fs.filter((f) => f.kind === kind).sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0))[0];

/** Link suggestions for a scan from its extracted fields: employee no -> HR, file no -> eOffice, voucher/reference (+ amount) -> finance. */
export async function suggestLinks(
  ctx: { tenantId: string; correlationId: string }, fields: readonly SuggestionField[], allowed: readonly LinkTarget[],
): Promise<Suggestion[]> {
  const calls: Promise<LookupResult>[] = [];
  const emp = bestField(fields, "employee_no");
  if (emp && allowed.includes("hr_employee")) calls.push(lookupTarget(ctx, { target: "hr_employee", q: emp.value }));
  const fileNo = bestField(fields, "file_no");
  if (fileNo && allowed.includes("eoffice_file")) calls.push(lookupTarget(ctx, { target: "eoffice_file", q: fileNo.value }));
  const ref = bestField(fields, "voucher_no") ?? bestField(fields, "reference_no");
  const amt = bestField(fields, "amount_inr");
  const amountMinor = amt && /^\d{1,18}$/.test(amt.value) ? amt.value : undefined;
  if (ref) for (const t of ["finance_voucher", "finance_payment", "finance_bill"] as const) if (allowed.includes(t)) calls.push(lookupTarget(ctx, { target: t, q: ref.value, amountMinor }));
  const results = await Promise.all(calls);
  const out: Suggestion[] = [];
  for (const r of results) for (const c of r.data) {
    out.push({
      target: c.target, targetId: c.targetId, label: c.label, confidence: c.confidence,
      ...(c.amountMinor ? { amountMinor: c.amountMinor } : {}), ...(c.reference ? { reference: c.reference } : {}),
      ...(c.amountMatches === false ? { mismatch: true } : {}),
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

export class ClearanceUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "ClearanceUnavailableError"; }
}

/**
 * eOffice clearance gate: asks estab whether `userId` (with `roles`) may see the eOffice file, using estab's own
 * classification-clearance rule. FAIL CLOSED: anything except a well-formed 200 throws ClearanceUnavailableError
 * (no secret configured, timeout, 4xx/5xx, bad shape, breaker open). Own breaker, separate from lookups.
 */
export async function checkEofficeClearance(
  ctx: { tenantId: string; correlationId: string }, a: { fileId: string; userId: string; roles: readonly string[] },
): Promise<{ allowed: boolean; reason: string | null }> {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) throw new ClearanceUnavailableError("INTERNAL_SERVICE_SECRET is not configured");
  const qs = new URLSearchParams({ fileId: a.fileId, userId: a.userId, roles: a.roles.join(",") });
  try {
    return await breakerFor("estab-clearance").call(async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs());
      try {
        const res = await fetch(`${baseUrl("estab")}/internal/v1/scan-link/clearance?${qs.toString()}`, {
          headers: { "x-internal": "1", "x-tenant-id": ctx.tenantId, "x-service-secret": secret, "x-internal-caller": "document-service", "x-correlation-id": ctx.correlationId },
          signal: ac.signal,
        });
        if (!res.ok) throw new Error("estab answered " + res.status);
        const body = (await res.json()) as { data?: { allowed?: unknown; reason?: unknown } };
        if (typeof body.data?.allowed !== "boolean") throw new Error("estab answered an unexpected shape");
        return { allowed: body.data.allowed, reason: typeof body.data.reason === "string" ? body.data.reason : null };
      } finally { clearTimeout(timer); }
    });
  } catch (e) {
    log.warn({ err: errMessage(e) }, "bulk-scan: eOffice clearance unavailable (failing closed)");
    throw new ClearanceUnavailableError("clearance check unavailable");
  }
}
