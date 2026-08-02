/**
 * CR-MKT-04 — email deliverability: DKIM / SPF / DMARC evaluation (pure).
 *
 * Nothing here touches the network. A scheduled/queued checker resolves the DNS
 * records and hands the observed strings to these functions, which decide
 * pass/fail per mechanism and roll that up into a single health status. Keeping
 * it pure is what makes the whole feature testable without a resolver.
 */

export type MechanismStatus = "pass" | "fail" | "missing";
export type DomainHealth = "healthy" | "degraded" | "failing" | "unknown";

export type ExpectedRecords = {
  /** DKIM selector, e.g. "s1" → TXT at s1._domainkey.<domain>. */
  dkimSelector: string;
  /** Expected public-key material (or a distinctive fragment of it). */
  dkimValue: string;
  /** Expected SPF include mechanism, e.g. "include:spf.example.net". */
  spfInclude: string;
  /** Expected DMARC policy: none | quarantine | reject. */
  dmarcPolicy: DmarcPolicy;
};

export type DmarcPolicy = "none" | "quarantine" | "reject";

export const DMARC_POLICIES: readonly DmarcPolicy[] = ["none", "quarantine", "reject"];

/** Raw TXT strings observed for each mechanism. Empty array = record absent. */
export type ObservedRecords = {
  dkimTxt: string[];
  spfTxt: string[];
  dmarcTxt: string[];
};

export type MechanismResults = {
  dkim: MechanismStatus;
  spf: MechanismStatus;
  dmarc: MechanismStatus;
};

/** Normalise a TXT record: DNS returns it in chunks that must be concatenated. */
function joinTxt(records: string[]): string {
  return records.join("").replace(/\s+/g, " ").trim();
}

export function evaluateDkim(expected: ExpectedRecords, observed: ObservedRecords): MechanismStatus {
  if (observed.dkimTxt.length === 0) return "missing";
  const txt = joinTxt(observed.dkimTxt);
  if (!/\bv=DKIM1\b/i.test(txt)) return "fail";
  // Compare against the expected key material with whitespace removed, because
  // DNS providers wrap long p= values differently.
  const flat = txt.replace(/\s/g, "");
  const want = expected.dkimValue.replace(/\s/g, "");
  return want.length > 0 && flat.includes(want) ? "pass" : "fail";
}

export function evaluateSpf(expected: ExpectedRecords, observed: ObservedRecords): MechanismStatus {
  if (observed.spfTxt.length === 0) return "missing";
  const txt = joinTxt(observed.spfTxt);
  if (!/\bv=spf1\b/i.test(txt)) return "fail";
  return txt.toLowerCase().includes(expected.spfInclude.toLowerCase()) ? "pass" : "fail";
}

export function evaluateDmarc(expected: ExpectedRecords, observed: ObservedRecords): MechanismStatus {
  if (observed.dmarcTxt.length === 0) return "missing";
  const txt = joinTxt(observed.dmarcTxt);
  if (!/\bv=DMARC1\b/i.test(txt)) return "fail";
  const m = /\bp\s*=\s*(none|quarantine|reject)\b/i.exec(txt);
  if (!m?.[1]) return "fail";
  return m[1].toLowerCase() === expected.dmarcPolicy ? "pass" : "fail";
}

export function evaluateRecords(expected: ExpectedRecords, observed: ObservedRecords): MechanismResults {
  return {
    dkim: evaluateDkim(expected, observed),
    spf: evaluateSpf(expected, observed),
    dmarc: evaluateDmarc(expected, observed),
  };
}

/**
 * Roll the three mechanisms up into one status.
 *
 * DKIM and SPF are the mechanisms receivers use to decide whether mail is
 * authorised, so a problem with either is "failing" — mail is at real risk of
 * rejection. DMARC only tells receivers what to do when the other two fail, so
 * a DMARC-only problem is "degraded": mail still delivers, but the domain is
 * unprotected against spoofing. All three absent means we have no signal at all
 * and report "unknown" rather than implying a verdict.
 */
export function overallHealth(results: MechanismResults): DomainHealth {
  if (results.dkim === "missing" && results.spf === "missing" && results.dmarc === "missing") {
    return "unknown";
  }
  if (results.dkim !== "pass" || results.spf !== "pass") return "failing";
  if (results.dmarc !== "pass") return "degraded";
  return "healthy";
}

/** True when the domain may be used as an envelope-from for tenant mail. */
export function isSendingAllowed(health: DomainHealth): boolean {
  return health === "healthy" || health === "degraded";
}
