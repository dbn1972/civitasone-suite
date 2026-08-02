/**
 * CR-MKT-04 — DNS probe for domain authentication.
 *
 * Deliberately NOT reachable from a route handler. The route only accepts a
 * *recorded* check result; the probe below is what a scheduled worker calls
 * before submitting that result. The resolver is an injectable interface so
 * tests stub it and never touch the network. Default implementation uses Node's
 * built-in `node:dns/promises` — no new dependency.
 */
import { resolveTxt as nodeResolveTxt } from "node:dns/promises";
import type { ExpectedRecords, ObservedRecords } from "./domain.js";

export interface DnsResolver {
  /** Resolve TXT records. Must resolve to [] (not throw) when absent. */
  resolveTxt(hostname: string): Promise<string[][]>;
}

/** Production resolver: Node's built-in DNS, with NXDOMAIN mapped to []. */
export const nodeDnsResolver: DnsResolver = {
  async resolveTxt(hostname: string): Promise<string[][]> {
    try {
      return await nodeResolveTxt(hostname);
    } catch {
      // ENOTFOUND / ENODATA / SERVFAIL all mean "no usable record" here. The
      // caller distinguishes absent from wrong via MechanismStatus "missing".
      return [];
    }
  },
};

export function dkimHost(domain: string, selector: string): string {
  return `${selector}._domainkey.${domain}`;
}

export function dmarcHost(domain: string): string {
  return `_dmarc.${domain}`;
}

/**
 * Resolve the three TXT records for a sending domain. Pure aside from the
 * injected resolver, so a stub makes this fully deterministic in tests.
 */
export async function probeDomainAuth(
  resolver: DnsResolver,
  domain: string,
  expected: ExpectedRecords,
): Promise<ObservedRecords> {
  const [dkim, spf, dmarc] = await Promise.all([
    resolver.resolveTxt(dkimHost(domain, expected.dkimSelector)),
    resolver.resolveTxt(domain),
    resolver.resolveTxt(dmarcHost(domain)),
  ]);
  return {
    dkimTxt: flatten(dkim),
    // The apex TXT set contains unrelated records; keep only the SPF one.
    spfTxt: flatten(spf).filter((t) => /\bv=spf1\b/i.test(t)),
    dmarcTxt: flatten(dmarc),
  };
}

function flatten(records: string[][]): string[] {
  return records.map((chunks) => chunks.join(""));
}
