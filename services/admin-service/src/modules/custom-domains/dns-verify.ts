/**
 * Custom-domain ownership proof (FQ12-SEC item #20).
 *
 * Checks the exact challenge the registration flow issues and that
 * GET /v1/admin/custom-domains/:id/dns-instructions shows the tenant:
 *
 *   dns_txt   -> TXT  "_civitasone-verification.<domain>" = <verificationToken>
 *   dns_cname -> CNAME "_civitasone-verify.<domain>"      -> verify.civitasone.app
 *
 * FAILS CLOSED: the only path to `verified: true` is a successful lookup whose
 * answer matches the challenge. NXDOMAIN, no record, a wrong value, a resolver
 * error and a timeout all return `verified: false` with a reason; nothing here
 * throws, so a caller can never treat an exception as success.
 *
 * The resolver is injectable (setDnsResolver) so tests never touch the network.
 */
import { promises as dnsPromises } from "node:dns";

export const TXT_CHALLENGE_LABEL = "_civitasone-verification";
export const CNAME_CHALLENGE_LABEL = "_civitasone-verify";
export const CNAME_CHALLENGE_TARGET = "verify.civitasone.app";
export const DEFAULT_DNS_TIMEOUT_MS = 5000;

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
}

export type VerificationMethod = "dns_txt" | "dns_cname";

export type VerificationResult =
  | { verified: true }
  | {
      verified: false;
      /**
       * no_record   - NXDOMAIN / NODATA: the challenge record does not exist (yet)
       * mismatch    - a record exists but does not carry the expected value
       * dns_error   - resolver failure (SERVFAIL, refused, network)
       * timeout     - resolver did not answer in time
       * unsupported - unknown verification method
       */
      reason: "no_record" | "mismatch" | "dns_error" | "timeout" | "unsupported";
      detail: string;
    };

const systemResolver: DnsResolver = {
  resolveTxt: (h) => dnsPromises.resolveTxt(h),
  resolveCname: (h) => dnsPromises.resolveCname(h),
};

let activeResolver: DnsResolver = systemResolver;

/** Swap the resolver (tests). Pass null to restore the system resolver. */
export function setDnsResolver(r: DnsResolver | null): void {
  activeResolver = r ?? systemResolver;
}

export function challengeHost(method: VerificationMethod, domain: string): string {
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  return `${method === "dns_txt" ? TXT_CHALLENGE_LABEL : CNAME_CHALLENGE_LABEL}.${d}`;
}

class DnsTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DnsTimeout(`dns lookup exceeded ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => { if (timer) clearTimeout(timer); });
}

const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ENONAME"]);

function classify(err: unknown): VerificationResult {
  if (err instanceof DnsTimeout) return { verified: false, reason: "timeout", detail: err.message };
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code === "ETIMEOUT") return { verified: false, reason: "timeout", detail: "dns lookup timed out" };
  if (NO_RECORD_CODES.has(code)) return { verified: false, reason: "no_record", detail: `challenge record not found (${code})` };
  return { verified: false, reason: "dns_error", detail: `dns lookup failed${code ? ` (${code})` : ""}` };
}

function normHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Check a domain's DNS challenge. Never throws; never returns verified on error.
 */
export async function checkDomainOwnership(
  input: { domain: string; verificationMethod: string; verificationToken: string },
  opts: { resolver?: DnsResolver; timeoutMs?: number } = {},
): Promise<VerificationResult> {
  const resolver = opts.resolver ?? activeResolver;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
  const token = input.verificationToken?.trim() ?? "";
  if (input.verificationMethod !== "dns_txt" && input.verificationMethod !== "dns_cname") {
    return { verified: false, reason: "unsupported", detail: `unsupported verification method ${String(input.verificationMethod)}` };
  }
  const method = input.verificationMethod as VerificationMethod;
  const host = challengeHost(method, input.domain);
  try {
    if (method === "dns_txt") {
      if (token.length === 0) return { verified: false, reason: "mismatch", detail: "no verification token on record" };
      const records = await withTimeout(resolver.resolveTxt(host), timeoutMs);
      if (!Array.isArray(records) || records.length === 0) {
        return { verified: false, reason: "no_record", detail: `no TXT record at ${host}` };
      }
      // A TXT record may be split into several <=255-byte chunks; join them.
      const match = records.some((chunks) => Array.isArray(chunks) && chunks.join("").trim() === token);
      return match
        ? { verified: true }
        : { verified: false, reason: "mismatch", detail: `TXT record at ${host} does not match the verification token` };
    }
    const targets = await withTimeout(resolver.resolveCname(host), timeoutMs);
    if (!Array.isArray(targets) || targets.length === 0) {
      return { verified: false, reason: "no_record", detail: `no CNAME record at ${host}` };
    }
    const match = targets.some((t) => typeof t === "string" && normHost(t) === CNAME_CHALLENGE_TARGET);
    return match
      ? { verified: true }
      : { verified: false, reason: "mismatch", detail: `CNAME at ${host} does not point to ${CNAME_CHALLENGE_TARGET}` };
  } catch (err) {
    return classify(err);
  }
}
