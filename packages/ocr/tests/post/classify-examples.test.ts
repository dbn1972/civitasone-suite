import { describe, expect, it } from "vitest";
import { CLASSIFIER_EXAMPLES } from "../../src/fixtures/examples.js";
import { DEFAULT_CLASSIFIER_CONFIG, classifyDetailed } from "../../src/post/classify.js";
import { makePage } from "./helpers.js";

describe("default classifier on typical example pages", () => {
  it.each(CLASSIFIER_EXAMPLES.filter((e) => e.docType !== "other").map((e) => [e.id, e] as const))("%s", (_id, ex) => {
    const d = classifyDetailed([makePage([...ex.lines])]);
    const out = `${ex.id}: ${JSON.stringify(d.candidates.slice(0, 3))} margin=${d.margin.toFixed(2)} conf=${d.classification.confidence}`;
    process.stdout.write(`CLS ${out}\n`);
    expect(d.classification.docType, out).toBe(ex.docType);
    expect(d.margin, out).toBeGreaterThanOrEqual(DEFAULT_CLASSIFIER_CONFIG.uncertainMargin);
    expect(d.classification.uncertain, out).toBe(false);
  });
  it.each(CLASSIFIER_EXAMPLES.filter((e) => e.docType === "other").map((e) => [e.id, e] as const))("%s -> other/uncertain", (_id, ex) => {
    const c = classifyDetailed([makePage([...ex.lines])]).classification;
    expect(c.docType).toBe("other");
    expect(c.uncertain).toBe(true);
  });
});

import { classify, classifyWithHook, classifyWithPreset, type ClassifierConfig } from "../../src/post/classify.js";

describe("defaults are explicit", () => {
  it("exports the chosen numbers", () => {
    expect(DEFAULT_CLASSIFIER_CONFIG.uncertainMargin).toBe(0.25);
    expect(DEFAULT_CLASSIFIER_CONFIG.minConfidence).toBe(0.5);
    for (const t of DEFAULT_CLASSIFIER_CONFIG.types) expect(t.id === "other" ? t.minScore === Number.POSITIVE_INFINITY : t.minScore === 3).toBe(true);
  });
  it("candidates are always >= 2 entries with labels", () => {
    for (const lines of [[""], ["completely unrelated"], ["OFFICE ORDER", "with immediate effect"]]) {
      const d = classifyDetailed([makePage(lines)]);
      expect(d.candidates.length).toBeGreaterThanOrEqual(2);
      expect(d.candidates.every((c) => typeof c.label === "string" && c.label.length > 0)).toBe(true);
      expect((d.candidates[0]?.score ?? 0) >= (d.candidates[1]?.score ?? 0)).toBe(true);
    }
  });
});

describe("negative / ambiguous cases", () => {
  const c = (lines: string[]) => classifyDetailed([makePage(lines)]).classification;
  it("empty or unrelated text -> other, uncertain", () => {
    for (const lines of [[""], ["   "], ["milk eggs bread"], ["कुछ भी नहीं"]]) expect(c(lines)).toMatchObject({ docType: "other", uncertain: true });
  });
  it("a single passing mention of 'sanction' does not make a sanction order", () => {
    expect(c(["Please note the sanction will follow later"]).docType).toBe("other");
  });
  it("a letter that mentions sanction stays a letter, certain", () => {
    const r = c(["To,", "The Director,", "Subject: Request for sanction of leave", "Dear Sir,", "Yours faithfully,"]);
    expect(r).toMatchObject({ docType: "letter", uncertain: false });
  });
  it("two equally strong titles -> uncertain", () => {
    const r = c(["SANCTION ORDER", "OFFICE ORDER", "with immediate effect"]);
    expect(r.uncertain).toBe(true);
  });
});

describe("classifyWithPreset", () => {
  const cfg = DEFAULT_CLASSIFIER_CONFIG;
  const pages = (lines: string[]) => [makePage(lines)];
  const orderPage = pages(["OFFICE ORDER", "No. 45/2024-Admn", "Shri A is posted as Clerk with immediate effect."]);

  it("no preset -> same as classify()", () => {
    const r = classifyWithPreset(orderPage, cfg, null);
    expect(r.presetDocType).toBeNull();
    expect(r.docType).toBe(classify(orderPage, cfg).docType);
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
  });
  it("preset agrees -> preset used, certain", () => {
    const r = classifyWithPreset(orderPage, cfg, "office_order");
    expect(r).toMatchObject({ docType: "office_order", presetDocType: "office_order", uncertain: false });
    expect(r.evidence).toContain("preset:office_order");
  });
  it("confident disagreement (different type, margin >= uncertainMargin, score >= minScore) -> uncertain, preset kept", () => {
    const r = classifyWithPreset(orderPage, cfg, "pay_slip");
    expect(r).toMatchObject({ docType: "pay_slip", uncertain: true });
    expect(r.evidence).toContain("confident-disagreement");
  });
  it("weak disagreement (thin margin) -> not uncertain", () => {
    const r = classifyWithPreset(pages(["SANCTION ORDER", "OFFICE ORDER", "with immediate effect"]), cfg, "letter");
    expect(r.uncertain).toBe(false);
  });
  it("classifier finds nothing (below minScore) -> preset trusted, not uncertain", () => {
    const r = classifyWithPreset(pages(["milk eggs bread"]), cfg, "certificate");
    expect(r).toMatchObject({ docType: "certificate", uncertain: false });
  });
  it("empty text with a preset -> not uncertain", () => {
    expect(classifyWithPreset(pages([""]), cfg, "letter").uncertain).toBe(false);
  });
  it("custom uncertainMargin is honoured", () => {
    const strict: ClassifierConfig = { ...cfg, uncertainMargin: 0.95 };
    const mixed = pages(["OFFICE ORDER", "In continuation of the sanction conveyed earlier, Shri X is posted as Clerk with immediate effect.", "Sanction is hereby accorded"]);
    expect(classifyWithPreset(mixed, strict, "sanction_order").uncertain).toBe(classifyDetailed(mixed, strict).margin >= 0.95 && classifyDetailed(mixed, strict).top?.docType !== "sanction_order");
  });
  it("AI hook behaviour unchanged by new fields", async () => {
    const r = await classifyWithHook(orderPage, cfg, async () => null);
    expect(r.docType).toBe("office_order");
  });
});
