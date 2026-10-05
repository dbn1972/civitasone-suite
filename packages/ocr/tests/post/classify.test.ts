import { describe, expect, it } from "vitest";
import {
  AI_EVIDENCE_PREFIX, DEFAULT_CLASSIFIER_CONFIG, classify, classifyWithHook, type AiClassifierHook, type ClassifierConfig,
} from "../../src/post/classify.js";
import { redactPagesForAi } from "../../src/post/pii.js";
import { generateAadhaar } from "../../src/post/verhoeff.js";
import { makePage } from "./helpers.js";

const cls = (lines: string[], cfg: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG) => classify([makePage(lines)], cfg);

describe("rule-based classifier (default English + Hindi rules)", () => {
  it.each([
    [["SERVICE BOOK", "Date of appointment: 01/04/1995", "Pay fixation entry verified by"], "service_book"],
    [["सेवा पुस्तिका", "जन्म तिथि 12/03/1970"], "service_book"],
    [["PAY SLIP for March 2024", "Basic Pay 45000 Deductions 5000", "Net Pay 40000"], "pay_slip"],
    [["वेतन पर्ची", "मूल वेतन 45000 कटौती 5000"], "pay_slip"],
    [["PAYMENT VOUCHER", "Voucher No: V-12/2024", "Payee: ABC Traders", "Rs. 45,000/-"], "bill_voucher"],
    [["Expenditure sanction", "Sanction is hereby accorded", "administrative approval"], "sanction_order"],
    [["व्यय की स्वीकृति", "प्रशासनिक मंजूरी"], "sanction_order"],
    [["OFFICE ORDER", "with immediate effect Shri X is posted as Clerk"], "office_order"],
    [["कार्यालय आदेश", "तत्काल प्रभाव से"], "office_order"],
    [["Dear Sir,", "Subject: Request", "Yours faithfully"], "letter"],
    [["विषय: अनुरोध", "महोदय", "भवदीय"], "letter"],
    [["Permanent Account Number", "Income Tax Department"], "id_proof"],
    [["This is to certify that Shri A completed the course", "CERTIFICATE"], "certificate"],
    [["प्रमाण पत्र", "प्रमाणित किया जाता है"], "certificate"],
  ])("%j -> %s", (lines, expected) => {
    const r = cls(lines);
    expect(r.docType).toBe(expected);
    expect(r.confidence).toBeGreaterThan(0.4);
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it("falls back to 'other' and is uncertain when nothing reaches minScore", () => {
    const r = cls(["completely unrelated grocery list", "milk eggs bread"]);
    expect(r).toMatchObject({ docType: "other", uncertain: true });
    expect(cls([""]).evidence).toContain("no text");
  });

  it("is uncertain when the top-2 margin is small", () => {
    const r = cls(["Service book", "Pay slip"]);
    expect(r.uncertain).toBe(true);
    expect(r.evidence.some((e) => e.startsWith("runner-up:"))).toBe(true);
  });

  it("is certain for a clear single-type page", () => {
    const r = cls(["OFFICE ORDER", "Office order no 4", "with immediate effect", "is directed to"]);
    expect(r.docType).toBe("office_order");
    expect(r.uncertain).toBe(false);
  });

  it("title-region and field-kind hints add evidence", () => {
    const page = makePage(["CERTIFICATE", "body line", "body line", "body line", "body line", "body line", "body line", "body line"]);
    expect(classify([page]).evidence.some((e) => e.startsWith("title:"))).toBe(true);
    const idr = classify([makePage(["scanned card"])], DEFAULT_CLASSIFIER_CONFIG, {
      fields: [{ kind: "aadhaar", value: "x", raw: "x", confidence: 1, pageNumber: 1, bbox: null }],
    });
    expect(idr.docType).toBe("id_proof");
  });

  it("is per-tenant configurable (custom type, regex rule, ASCII word boundaries)", () => {
    const cfg: ClassifierConfig = {
      uncertainMargin: 0.2, minConfidence: 0.4,
      types: [
        { id: "gate_pass", label: "Gate pass", minScore: 2, keywords: [{ term: "gate pass", weight: 2 }], regex: [{ pattern: "GP-\\d{4}", weight: 1.5, label: "gp-number" }] },
        { id: "other", label: "Other", keywords: [], minScore: Number.POSITIVE_INFINITY },
      ],
    };
    const r = cls(["Gate Pass issued", "GP-1234"], cfg);
    expect(r.docType).toBe("gate_pass");
    expect(r.evidence.join("|")).toContain("regex:gp-number");
    expect(cls(["navigate passage"], cfg).docType).toBe("other"); // no substring match inside words
  });

  it("keyword matching is case/whitespace-insensitive", () => {
    expect(cls(["  PAY    SLIP  ", "basic pay", "net pay"]).docType).toBe("pay_slip");
  });
});

describe("AI hook (off by default, capped, marked)", () => {
  const uncertainPages = [makePage(["Service book", "Pay slip"])];
  const hook: AiClassifierHook = async () => ({ docType: "pay_slip", confidence: 0.99, evidence: ["looks like payroll"], uncertain: false });

  it("is NOT invoked when disabled (default) even if supplied", async () => {
    let called = 0;
    const r = await classifyWithHook(uncertainPages, DEFAULT_CLASSIFIER_CONFIG, async () => { called++; return null; });
    expect(called).toBe(0);
    expect(r.evidence.some((e) => e.startsWith(AI_EVIDENCE_PREFIX))).toBe(false);
  });

  it("when enabled: confidence capped, always uncertain, evidence marked", async () => {
    const cfg: ClassifierConfig = { ...DEFAULT_CLASSIFIER_CONFIG, ai: { enabled: true, maxConfidence: 0.7 } };
    const r = await classifyWithHook(uncertainPages, cfg, hook);
    expect(r.docType).toBe("pay_slip");
    expect(r.confidence).toBeLessThanOrEqual(0.7);
    expect(r.uncertain).toBe(true);
    expect(r.evidence.some((e) => e.startsWith(AI_EVIDENCE_PREFIX))).toBe(true);
  });

  it("is not consulted when rules are already certain", async () => {
    const cfg: ClassifierConfig = { ...DEFAULT_CLASSIFIER_CONFIG, ai: { enabled: true, maxConfidence: 0.7 } };
    let called = 0;
    await classifyWithHook([makePage(["OFFICE ORDER", "Office order no 4", "with immediate effect", "is directed to"])], cfg, async () => { called++; return null; });
    expect(called).toBe(0);
  });

  it("ignores unknown doc types, null and throwing hooks", async () => {
    const cfg: ClassifierConfig = { ...DEFAULT_CLASSIFIER_CONFIG, ai: { enabled: true, maxConfidence: 0.7 } };
    const base = await classifyWithHook(uncertainPages, DEFAULT_CLASSIFIER_CONFIG, hook);
    expect((await classifyWithHook(uncertainPages, cfg, async () => ({ docType: "made_up", confidence: 0.9, evidence: [], uncertain: false }))).docType).toBe(base.docType);
    expect((await classifyWithHook(uncertainPages, cfg, async () => null)).evidence.some((e) => e.startsWith("ai:"))).toBe(false);
    expect((await classifyWithHook(uncertainPages, cfg, async () => { throw new Error("boom"); })).docType).toBe(base.docType);
  });

  it("passes top candidates (with scores) to the hook", async () => {
    const cfg: ClassifierConfig = { ...DEFAULT_CLASSIFIER_CONFIG, ai: { enabled: true, maxConfidence: 0.7, maxCandidates: 2 } };
    let seen: string[] = [];
    await classifyWithHook(uncertainPages, cfg, async (_t, c) => { seen = c.map((x) => x.docType); return null; });
    expect(seen).toHaveLength(2);
    expect(seen).toContain("service_book");
  });
});

describe("AI hook never sees PII", () => {
  const AADH = generateAadhaar("23456789012");
  const piiPages = [makePage([`Service book Pay slip Aadhaar ${AADH.slice(0, 4)} ${AADH.slice(4, 8)} ${AADH.slice(8)}`, "PAN ABCPE1234F phone +91 98765 43210 mail a.b@x.gov.in", "A/c No. 123456789012 UID 234567890126", "next line 2345\n6789\n0123"])];
  const RAW = [AADH, `${AADH.slice(0, 4)} ${AADH.slice(4, 8)}`, "ABCPE1234F", "9876543210", "98765 43210", "a.b@x.gov.in", "123456789012", "234567890126"];

  it("receives fully redacted text, independent of any tenant policy (no last-4 partials either)", async () => {
    const cfg: ClassifierConfig = { ...DEFAULT_CLASSIFIER_CONFIG, ai: { enabled: true, maxConfidence: 0.7 } };
    const seen: string[] = [];
    const spy: AiClassifierHook = async (t: string) => { seen.push(t); return null; };
    await classifyWithHook(piiPages, cfg, spy);
    expect(seen).toHaveLength(1);
    const text = seen[0]!;
    for (const raw of RAW) expect(text).not.toContain(raw);
    expect(text).not.toMatch(/\b2345\s+6789\s+0123\b/);
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain(AADH.slice(-4));
    expect(text).toContain("Service book Pay slip"); // non-PII text still reaches the hook
  });

  it("redactPagesForAi masks every page", () => {
    const out = redactPagesForAi([{ pageNumber: 1, text: `a ${AADH}` }, { pageNumber: 2, text: "mail a.b@x.gov.in" }]);
    expect(out).toBe("a [REDACTED]\nmail [REDACTED]");
  });
});
