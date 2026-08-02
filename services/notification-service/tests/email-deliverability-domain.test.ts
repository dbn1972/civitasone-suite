/**
 * CR-MKT-04 — DKIM/SPF/DMARC evaluation, health roll-up, and the DNS probe.
 *
 * The probe is exercised through a stub resolver, so nothing here touches the
 * network. That is the point of the injectable DnsResolver: the evaluation logic
 * is deterministic and testable offline.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateDkim,
  evaluateSpf,
  evaluateDmarc,
  evaluateRecords,
  overallHealth,
  isSendingAllowed,
  DMARC_POLICIES,
  type ExpectedRecords,
  type ObservedRecords,
  type MechanismResults,
} from "../src/modules/email/domain.js";
import {
  probeDomainAuth,
  dkimHost,
  dmarcHost,
  nodeDnsResolver,
  type DnsResolver,
} from "../src/modules/email/dns.js";

const EXPECTED: ExpectedRecords = {
  dkimSelector: "s1",
  dkimValue: "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC",
  spfInclude: "include:spf.civitasone.gov.in",
  dmarcPolicy: "reject",
};

function observed(over: Partial<ObservedRecords> = {}): ObservedRecords {
  return { dkimTxt: [], spfTxt: [], dmarcTxt: [], ...over };
}

describe("evaluateDkim", () => {
  it("missing when no TXT record was returned", () => {
    expect(evaluateDkim(EXPECTED, observed())).toBe("missing");
  });

  it("passes when v=DKIM1 and the expected key material is present", () => {
    expect(evaluateDkim(EXPECTED, observed({
      dkimTxt: [`v=DKIM1; k=rsa; p=${EXPECTED.dkimValue}xyz`],
    }))).toBe("pass");
  });

  it("passes when the provider wrapped the p= value across chunks", () => {
    // DNS returns long TXT values in 255-byte chunks that must be concatenated.
    expect(evaluateDkim(EXPECTED, observed({
      dkimTxt: ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3", "DQEBAQUAA4GNADCBiQKBgQC"],
    }))).toBe("pass");
  });

  it("passes when whitespace was inserted into the key material", () => {
    expect(evaluateDkim(EXPECTED, observed({
      dkimTxt: ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3 DQEBAQUAA4GNADCBiQKBgQC"],
    }))).toBe("pass");
  });

  it("fails when v=DKIM1 is absent", () => {
    expect(evaluateDkim(EXPECTED, observed({ dkimTxt: [`p=${EXPECTED.dkimValue}`] }))).toBe("fail");
  });

  it("fails when the key material does not match", () => {
    expect(evaluateDkim(EXPECTED, observed({ dkimTxt: ["v=DKIM1; k=rsa; p=SOMEOTHERKEY"] }))).toBe("fail");
  });

  it("fails when the expected value is blank — an unverifiable claim is not a pass", () => {
    expect(evaluateDkim({ ...EXPECTED, dkimValue: "" }, observed({ dkimTxt: ["v=DKIM1; p=x"] }))).toBe("fail");
  });

  it("is case-insensitive about the v=DKIM1 tag", () => {
    expect(evaluateDkim(EXPECTED, observed({ dkimTxt: [`v=dkim1; p=${EXPECTED.dkimValue}`] }))).toBe("pass");
  });
});

describe("evaluateSpf", () => {
  it("missing when no TXT record was returned", () => {
    expect(evaluateSpf(EXPECTED, observed())).toBe("missing");
  });

  it("passes when v=spf1 and the include mechanism are present", () => {
    expect(evaluateSpf(EXPECTED, observed({
      spfTxt: ["v=spf1 include:spf.civitasone.gov.in -all"],
    }))).toBe("pass");
  });

  it("is case-insensitive about the include host", () => {
    expect(evaluateSpf(EXPECTED, observed({
      spfTxt: ["v=spf1 INCLUDE:SPF.CIVITASONE.GOV.IN -all"],
    }))).toBe("pass");
  });

  it("fails when v=spf1 is absent", () => {
    expect(evaluateSpf(EXPECTED, observed({ spfTxt: ["include:spf.civitasone.gov.in -all"] }))).toBe("fail");
  });

  it("fails when the include mechanism is absent", () => {
    expect(evaluateSpf(EXPECTED, observed({ spfTxt: ["v=spf1 include:other.example -all"] }))).toBe("fail");
  });

  it("joins chunked TXT before matching", () => {
    expect(evaluateSpf(EXPECTED, observed({
      spfTxt: ["v=spf1 include:spf.civitas", "one.gov.in -all"],
    }))).toBe("pass");
  });
});

describe("evaluateDmarc", () => {
  it("missing when no TXT record was returned", () => {
    expect(evaluateDmarc(EXPECTED, observed())).toBe("missing");
  });

  it("passes when the policy matches", () => {
    expect(evaluateDmarc(EXPECTED, observed({ dmarcTxt: ["v=DMARC1; p=reject; rua=mailto:a@b.c"] }))).toBe("pass");
  });

  it("fails when the policy is weaker than expected", () => {
    expect(evaluateDmarc(EXPECTED, observed({ dmarcTxt: ["v=DMARC1; p=none"] }))).toBe("fail");
  });

  it("fails when v=DMARC1 is absent", () => {
    expect(evaluateDmarc(EXPECTED, observed({ dmarcTxt: ["p=reject"] }))).toBe("fail");
  });

  it("fails when there is no p= tag at all", () => {
    expect(evaluateDmarc(EXPECTED, observed({ dmarcTxt: ["v=DMARC1; rua=mailto:a@b.c"] }))).toBe("fail");
  });

  it("fails on an unrecognised policy value", () => {
    expect(evaluateDmarc(EXPECTED, observed({ dmarcTxt: ["v=DMARC1; p=block"] }))).toBe("fail");
  });

  it("tolerates whitespace around the = in p=", () => {
    expect(evaluateDmarc(EXPECTED, observed({ dmarcTxt: ["v=DMARC1; p = reject"] }))).toBe("pass");
  });

  it("is case-insensitive about the policy value", () => {
    expect(evaluateDmarc(EXPECTED, observed({ dmarcTxt: ["v=DMARC1; p=REJECT"] }))).toBe("pass");
  });

  it("matches a p=none expectation", () => {
    expect(evaluateDmarc({ ...EXPECTED, dmarcPolicy: "none" }, observed({ dmarcTxt: ["v=DMARC1; p=none"] })))
      .toBe("pass");
  });
});

describe("evaluateRecords", () => {
  it("evaluates all three mechanisms in one pass", () => {
    const results = evaluateRecords(EXPECTED, observed({
      dkimTxt: [`v=DKIM1; p=${EXPECTED.dkimValue}`],
      spfTxt: ["v=spf1 include:spf.civitasone.gov.in -all"],
      dmarcTxt: ["v=DMARC1; p=reject"],
    }));
    expect(results).toEqual({ dkim: "pass", spf: "pass", dmarc: "pass" });
  });
});

describe("overallHealth", () => {
  const results = (over: Partial<MechanismResults>): MechanismResults =>
    ({ dkim: "pass", spf: "pass", dmarc: "pass", ...over });

  it("all three passing → healthy", () => {
    expect(overallHealth(results({}))).toBe("healthy");
  });

  it("all three missing → unknown, not a verdict", () => {
    expect(overallHealth({ dkim: "missing", spf: "missing", dmarc: "missing" })).toBe("unknown");
  });

  it("DKIM failing → failing (mail is at real risk of rejection)", () => {
    expect(overallHealth(results({ dkim: "fail" }))).toBe("failing");
  });

  it("DKIM missing → failing", () => {
    expect(overallHealth(results({ dkim: "missing" }))).toBe("failing");
  });

  it("SPF failing → failing", () => {
    expect(overallHealth(results({ spf: "fail" }))).toBe("failing");
  });

  it("SPF missing → failing", () => {
    expect(overallHealth(results({ spf: "missing" }))).toBe("failing");
  });

  it("DMARC-only problem → degraded (mail delivers, spoofing is unprotected)", () => {
    expect(overallHealth(results({ dmarc: "fail" }))).toBe("degraded");
  });

  it("DMARC missing → degraded", () => {
    expect(overallHealth(results({ dmarc: "missing" }))).toBe("degraded");
  });

  it("DKIM+SPF failing with DMARC passing is still failing", () => {
    expect(overallHealth({ dkim: "fail", spf: "fail", dmarc: "pass" })).toBe("failing");
  });
});

describe("isSendingAllowed", () => {
  it("healthy may send", () => {
    expect(isSendingAllowed("healthy")).toBe(true);
  });

  it("degraded may send — mail still delivers", () => {
    expect(isSendingAllowed("degraded")).toBe(true);
  });

  it("failing may not send", () => {
    expect(isSendingAllowed("failing")).toBe(false);
  });

  it("unknown may not send — no signal is not a green light", () => {
    expect(isSendingAllowed("unknown")).toBe(false);
  });
});

describe("DMARC_POLICIES", () => {
  it("declares exactly none, quarantine and reject", () => {
    expect([...DMARC_POLICIES]).toEqual(["none", "quarantine", "reject"]);
  });
});

describe("DNS probe host construction", () => {
  it("builds the DKIM selector host", () => {
    expect(dkimHost("dept.gov.in", "s1")).toBe("s1._domainkey.dept.gov.in");
  });

  it("builds the DMARC host", () => {
    expect(dmarcHost("dept.gov.in")).toBe("_dmarc.dept.gov.in");
  });
});

describe("probeDomainAuth — stubbed resolver, no network", () => {
  function stub(map: Record<string, string[][]>): DnsResolver {
    return { resolveTxt: async (host) => map[host] ?? [] };
  }

  it("resolves all three records and joins chunked values", async () => {
    const result = await probeDomainAuth(stub({
      "s1._domainkey.dept.gov.in": [["v=DKIM1; p=AAA", "BBB"]],
      "dept.gov.in": [["v=spf1 include:spf.civitasone.gov.in -all"]],
      "_dmarc.dept.gov.in": [["v=DMARC1; p=reject"]],
    }), "dept.gov.in", EXPECTED);
    expect(result.dkimTxt).toEqual(["v=DKIM1; p=AAABBB"]);
    expect(result.spfTxt).toEqual(["v=spf1 include:spf.civitasone.gov.in -all"]);
    expect(result.dmarcTxt).toEqual(["v=DMARC1; p=reject"]);
  });

  it("keeps only the SPF record from a busy apex TXT set", async () => {
    const result = await probeDomainAuth(stub({
      "dept.gov.in": [
        ["google-site-verification=abc"],
        ["v=spf1 include:spf.civitasone.gov.in -all"],
        ["MS=ms12345"],
      ],
    }), "dept.gov.in", EXPECTED);
    expect(result.spfTxt).toEqual(["v=spf1 include:spf.civitasone.gov.in -all"]);
  });

  it("returns empty arrays when nothing resolves", async () => {
    const result = await probeDomainAuth(stub({}), "dept.gov.in", EXPECTED);
    expect(result).toEqual({ dkimTxt: [], spfTxt: [], dmarcTxt: [] });
    // Which the evaluator reports as "no signal", not as a failure verdict.
    expect(overallHealth(evaluateRecords(EXPECTED, result))).toBe("unknown");
  });
});

describe("nodeDnsResolver", () => {
  it("maps a non-resolving name to [] instead of throwing", async () => {
    // .invalid is reserved by RFC 2606 and can never resolve.
    await expect(nodeDnsResolver.resolveTxt("no-such-host.invalid")).resolves.toEqual([]);
  });
});
