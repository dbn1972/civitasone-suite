/**
 * Rule-based, per-tenant configurable document classifier. Deterministic, no network.
 * An optional AI hook can be supplied but is OFF unless config.ai.enabled === true; it can only ever
 * produce a capped, review-flagged, evidence-marked result for a type that exists in the config.
 */
import type { Classification, ExtractedField, FieldKind, PageResult } from "../types.js";
import { redactPagesForAi } from "./pii.js";

export interface KeywordRule { term: string; weight: number; lang?: string }
export interface RegexRule { pattern: string; flags?: string; weight: number; label?: string }
export interface LayoutHints {
  /** Terms that score only when found in the top of the page (title region). */
  titleTerms?: KeywordRule[];
  /** Extracted-field kinds whose presence adds weight (needs `fields` option). */
  fieldKinds?: { kind: FieldKind; weight: number }[];
  /** Adds weight when the page text looks tabular (many lines with 3+ columns separated by 2+ spaces/tabs/pipes). */
  tabular?: { weight: number };
}
export interface ClassifierTypeRule {
  id: string;
  label: string;
  keywords: KeywordRule[];
  regex?: RegexRule[];
  layoutHints?: LayoutHints;
  /** Minimum raw score for the type to be a candidate at all. */
  minScore: number;
}
export interface ClassifierConfig {
  types: ClassifierTypeRule[];
  /** Min relative gap (top-second)/top below which the result is `uncertain`. */
  uncertainMargin: number;
  /** Confidence below this => uncertain. */
  minConfidence: number;
  /** Type id used when no rule reaches its minScore. Default "other". */
  fallbackType?: string;
  ai?: { enabled: boolean; maxConfidence: number; maxCandidates?: number };
}

export interface ClassifyCandidate { docType: string; label: string; score: number }
export type AiClassifierHook = (text: string, candidates: ClassifyCandidate[]) => Promise<Classification | null>;

export interface ClassifyOptions {
  fields?: readonly ExtractedField[];
}

export const AI_EVIDENCE_PREFIX = "ai:";

const kw = (term: string, weight: number, lang?: string): KeywordRule => (lang ? { term, weight, lang } : { term, weight });

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  uncertainMargin: 0.25,
  minConfidence: 0.5,
  fallbackType: "other",
  ai: { enabled: false, maxConfidence: 0.7 },
  types: [
    {
      id: "service_book", label: "Service book", minScore: 3,
      keywords: [
        kw("service book", 4, "eng"), kw("सेवा पुस्तिका", 4, "hin"), kw("सेवा-पुस्तिका", 4, "hin"),
        kw("date of appointment", 1.5, "eng"), kw("pay fixation", 1.5, "eng"), kw("नियुक्ति की तिथि", 1.5, "hin"), kw("वेतन निर्धारण", 1.5, "hin"), kw("वेतन वृद्धि", 1, "hin"), kw("increment", 1, "eng"),
        kw("nomination", 1, "eng"), kw("date of birth", 0.75, "eng"), kw("जन्म तिथि", 0.75, "hin"),
        kw("verified by", 0.75, "eng"), kw("entries", 0.5, "eng"),
      ],
      layoutHints: { titleTerms: [kw("service book", 2, "eng"), kw("सेवा पुस्तिका", 2, "hin")] },
    },
    {
      id: "pay_slip", label: "Pay slip", minScore: 3,
      keywords: [
        kw("pay slip", 4, "eng"), kw("payslip", 4, "eng"), kw("salary slip", 4, "eng"), kw("वेतन पर्ची", 4, "hin"),
        kw("basic pay", 1.5, "eng"), kw("net pay", 1.5, "eng"), kw("gross", 1, "eng"),
        kw("deductions", 1.5, "eng"), kw("earnings", 1, "eng"), kw("मूल वेतन", 1.5, "hin"), kw("शुद्ध वेतन", 1.5, "hin"), kw("महंगाई भत्ता", 1, "hin"), kw("कुल आय", 1, "hin"), kw("कटौती", 1.5, "hin"),
      ],
      layoutHints: { tabular: { weight: 1 }, fieldKinds: [{ kind: "employee_no", weight: 1 }] },
    },
    {
      id: "bill_voucher", label: "Bill / voucher", minScore: 3,
      keywords: [
        kw("voucher", 3, "eng"), kw("वाउचर", 3, "hin"), kw("invoice", 2.5, "eng"), kw("bill no", 2, "eng"),
        kw("payee", 1.5, "eng"), kw("gstin", 1, "eng"), kw("gst", 0.75, "eng"), kw("amount in words", 1, "eng"),
        kw("पावती", 1.5, "hin"), kw("प्राप्तकर्ता", 1.5, "hin"), kw("शब्दों में राशि", 1, "hin"), kw("बिल संख्या", 2, "hin"), kw("चालान", 2, "hin"), kw("वाउचर संख्या", 1.5, "hin"), kw("received with thanks", 1.5, "eng"), kw("bill", 1, "eng"),
      ],
      layoutHints: { fieldKinds: [{ kind: "amount_inr", weight: 1 }, { kind: "voucher_no", weight: 1.5 }] },
    },
    {
      id: "sanction_order", label: "Sanction order", minScore: 3,
      keywords: [
        kw("is hereby sanctioned", 4, "eng"), kw("sanction order", 4, "eng"), kw("sanction", 2, "eng"),
        kw("sanctioned", 2, "eng"), kw("sanction is hereby accorded", 4, "eng"), kw("स्वीकृति आदेश", 4, "hin"), kw("प्रशासनिक स्वीकृति", 2.5, "hin"), kw("administrative approval", 2.5, "eng"), kw("expenditure sanction", 4, "eng"),
        kw("स्वीकृति", 2, "hin"), kw("मंजूरी", 2, "hin"), kw("स्वीकृत", 1.5, "hin"),
      ],
      layoutHints: { fieldKinds: [{ kind: "amount_inr", weight: 1 }, { kind: "file_no", weight: 0.5 }] },
    },
    {
      id: "office_order", label: "Office order", minScore: 3,
      keywords: [
        kw("office order", 4, "eng"), kw("कार्यालय आदेश", 4, "hin"), kw("office memorandum", 3, "eng"),
        kw("with immediate effect", 1.5, "eng"), kw("posted as", 1.5, "eng"), kw("is directed", 1.5, "eng"),
        kw("transferred", 1, "eng"), kw("order no", 1.5, "eng"), kw("is posted", 1.5, "eng"), kw("will report to", 1, "eng"), kw("स्थानांतरण", 1.5, "hin"), kw("आदेश", 1.5, "hin"), kw("तत्काल प्रभाव", 1.5, "hin"),
      ],
      layoutHints: { titleTerms: [kw("office order", 2, "eng"), kw("कार्यालय आदेश", 2, "hin")] },
    },
    {
      id: "letter", label: "Letter", minScore: 3,
      keywords: [
        kw("dear sir", 2.5, "eng"), kw("dear madam", 2.5, "eng"), kw("yours faithfully", 2.5, "eng"),
        kw("yours sincerely", 2.5, "eng"), kw("subject:", 1, "eng"), kw("sub:", 1, "eng"),
        kw("विषय", 1.5, "hin"), kw("भवदीय", 2.5, "hin"), kw("महोदय", 2, "hin"), kw("ref no", 1, "eng"),
      ],
    },
    {
      id: "id_proof", label: "ID proof", minScore: 3,
      keywords: [
        kw("unique identification authority", 4, "eng"), kw("aadhaar", 3, "eng"), kw("आधार", 3, "hin"),
        kw("permanent account number", 4, "eng"), kw("income tax department", 3, "eng"), kw("govt. of india", 0.5, "eng"),
        kw("election commission of india", 4, "eng"), kw("driving licence", 4, "eng"), kw("driving license", 4, "eng"),
        kw("passport", 3, "eng"), kw("विशिष्ट पहचान", 4, "hin"), kw("पहचान पत्र", 3, "hin"), kw("स्थायी खाता संख्या", 4, "hin"), kw("आयकर विभाग", 3, "hin"), kw("voter", 1.5, "eng"), kw("identity card", 3, "eng"),
      ],
      layoutHints: { fieldKinds: [{ kind: "aadhaar", weight: 3 }, { kind: "pan", weight: 3 }] },
    },
    {
      id: "certificate", label: "Certificate", minScore: 3,
      keywords: [
        kw("this is to certify", 4, "eng"), kw("certificate", 3, "eng"), kw("certified that", 3, "eng"),
        kw("प्रमाण पत्र", 4, "hin"), kw("प्रमाणपत्र", 4, "hin"), kw("प्रमाणित", 2.5, "hin"), kw("certify", 2, "eng"),
      ],
      layoutHints: { titleTerms: [kw("certificate", 2, "eng"), kw("प्रमाण पत्र", 2, "hin")] },
    },
    { id: "other", label: "Other", keywords: [], minScore: Number.POSITIVE_INFINITY },
  ],
};

// ---------------------------------------------------------------- matching

const norm = (s: string): string => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termRegex(term: string): RegExp {
  const t = escapeRe(norm(term)).replace(/ /g, "\\s+");
  // \b-like guards only for ASCII word edges; Indic text has no reliable \b.
  const pre = /^[a-z0-9]/.test(norm(term)) ? "(?<![a-z0-9])" : "";
  const post = /[a-z0-9]$/.test(norm(term)) ? "(?![a-z0-9])" : "";
  return new RegExp(`${pre}${t}${post}`, "u");
}

function titleRegion(pages: readonly PageResult[]): string {
  const first = pages[0];
  if (!first) return "";
  const lines = first.blocks.flatMap((b) => b.lines);
  if (lines.length === 0) return norm(first.text.split("\n").slice(0, 6).join(" "));
  const maxY = Math.max(...lines.map((l) => l.bbox.y1));
  const cutoff = maxY * 0.25;
  return norm(lines.filter((l) => l.bbox.y0 <= cutoff).map((l) => l.text).join(" "));
}

function looksTabular(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 4) return false;
  const cols = lines.filter((l) => l.trim().split(/\s{2,}|\t|\|/).length >= 3).length;
  return cols / lines.length >= 0.4;
}

interface Scored { id: string; label: string; score: number; evidence: string[]; minScore: number }

function scoreType(
  t: ClassifierTypeRule,
  fullText: string,
  title: string,
  rawText: string,
  fields: readonly ExtractedField[],
): Scored {
  let score = 0;
  const evidence: string[] = [];
  for (const k of t.keywords) {
    if (termRegex(k.term).test(fullText)) {
      score += k.weight;
      evidence.push(`keyword:"${k.term}"(+${k.weight})`);
    }
  }
  for (const r of t.regex ?? []) {
    if (new RegExp(r.pattern, r.flags ?? "iu").test(rawText)) {
      score += r.weight;
      evidence.push(`regex:${r.label ?? r.pattern}(+${r.weight})`);
    }
  }
  const h = t.layoutHints;
  if (h) {
    for (const k of h.titleTerms ?? []) {
      if (termRegex(k.term).test(title)) {
        score += k.weight;
        evidence.push(`title:"${k.term}"(+${k.weight})`);
      }
    }
    for (const f of h.fieldKinds ?? []) {
      if (fields.some((x) => x.kind === f.kind)) {
        score += f.weight;
        evidence.push(`field:${f.kind}(+${f.weight})`);
      }
    }
    if (h.tabular && looksTabular(rawText)) {
      score += h.tabular.weight;
      evidence.push(`layout:tabular(+${h.tabular.weight})`);
    }
  }
  return { id: t.id, label: t.label, score, evidence, minScore: t.minScore };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Synchronous rule-only classification (always LLM-free). */
export function classify(
  pages: readonly PageResult[],
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
  opts: ClassifyOptions = {},
): Classification {
  return classifyDetailed(pages, config, opts).classification;
}

export interface DetailedClassification {
  classification: Classification;
  /** Sorted by score desc. ALWAYS has at least 2 entries (zero-score types pad it); [0] and [1] are the top-2. */
  candidates: ClassifyCandidate[];
  /** (top - second) / top over qualified types; 0 when nothing qualified. */
  margin: number;
  /** Best type that reached its minScore, or null. */
  top: { docType: string; score: number; minScore: number } | null;
}

export function classifyDetailed(
  pages: readonly PageResult[],
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
  opts: ClassifyOptions = {},
): DetailedClassification {
  const rawText = pages.map((p) => p.text).join("\n");
  const fullText = norm(rawText);
  const title = titleRegion(pages);
  const fields = opts.fields ?? [];
  const fallback = config.fallbackType ?? "other";
  const scored = config.types
    .map((t) => scoreType(t, fullText, title, rawText, fields))
    .sort((a, b) => b.score - a.score);
  const qualified = scored.filter((s) => s.score > 0 && s.score >= s.minScore);
  const positive = scored.filter((s) => s.score > 0);
  const padded = positive.length >= 2 ? positive : [...positive, ...scored.filter((s) => s.score <= 0)].slice(0, 2);
  const candidates = padded.map((s) => ({ docType: s.id, label: s.label, score: round3(Math.max(0, s.score)) }));
  const top = qualified[0];
  if (!top) {
    return {
      classification: {
        docType: fallback, confidence: 0.3, uncertain: true,
        evidence: [fullText === "" ? "no text" : "no rule reached its minScore"],
      },
      candidates, margin: 0, top: null,
    };
  }
  const second = qualified[1];
  const secondScore = second?.score ?? 0;
  const absolute = top.score / (top.score + top.minScore);
  const confidence = round3(Math.min(0.99, absolute * (1 - 0.5 * (secondScore / top.score))));
  const margin = (top.score - secondScore) / top.score;
  const uncertain = margin < config.uncertainMargin || confidence < config.minConfidence;
  const evidence = [...top.evidence];
  if (second) evidence.push(`runner-up:${second.id}(score ${round3(secondScore)})`);
  return {
    classification: { docType: top.id, confidence, evidence, uncertain }, candidates, margin: round3(margin),
    top: { docType: top.id, score: round3(top.score), minScore: top.minScore },
  };
}

export interface PresetClassification extends Classification {
  presetDocType: string | null;
  candidates: ClassifyCandidate[];
}

/**
 * Classification when the uploader/batch already chose a document type. The preset is used as docType.
 * `uncertain` is true ONLY on a confident disagreement: the classifier's best type differs from the preset AND
 * margin >= config.uncertainMargin AND score >= that type's minScore. Otherwise false. No preset -> normal behaviour.
 */
export function classifyWithPreset(
  pages: readonly PageResult[],
  config: ClassifierConfig,
  presetDocType: string | null | undefined,
  opts: ClassifyOptions = {},
): PresetClassification {
  const d = classifyDetailed(pages, config, opts);
  if (!presetDocType) return { ...d.classification, presetDocType: null, candidates: d.candidates };
  const disagree =
    d.top !== null && d.top.docType !== presetDocType && d.margin >= config.uncertainMargin && d.top.score >= d.top.minScore;
  const evidence = [`preset:${presetDocType}`];
  if (d.top) evidence.push(`classifier:${d.top.docType}(score ${d.top.score}, margin ${d.margin})`);
  if (disagree) evidence.push("confident-disagreement");
  return {
    docType: presetDocType,
    confidence: disagree ? 0.5 : d.top?.docType === presetDocType ? Math.max(0.9, d.classification.confidence) : 0.9,
    uncertain: disagree,
    evidence,
    presetDocType,
    candidates: d.candidates,
  };
}

/**
 * Rules first; the AI hook is consulted ONLY when config.ai.enabled === true, a hook is supplied, and the rule
 * result is uncertain. Its answer is ignored unless its docType exists in config.types; confidence is capped at
 * config.ai.maxConfidence (it can never raise confidence above the cap), the result is always `uncertain`
 * (human review) and evidence is prefixed "ai:". Hook errors are swallowed (rules result stands).
 */
export async function classifyWithHook(
  pages: readonly PageResult[],
  config: ClassifierConfig,
  hook: AiClassifierHook | null | undefined,
  opts: ClassifyOptions = {},
): Promise<Classification> {
  const { classification, candidates } = classifyDetailed(pages, config, opts);
  const ai = config.ai;
  if (!ai?.enabled || !hook || !classification.uncertain) return classification;
  let res: Classification | null = null;
  try {
    // The hook must NEVER see PII: it gets fully redacted text, independent of any tenant mask/flag policy.
    // (Fail closed: if redaction itself throws, the hook is not called and the rules result stands.)
    res = await hook(redactPagesForAi(pages), candidates.slice(0, ai.maxCandidates ?? 5));
  } catch {
    return classification;
  }
  if (!res || !config.types.some((t) => t.id === res?.docType)) return classification;
  const cap = Math.max(0, Math.min(1, ai.maxConfidence));
  const aiConf = Math.max(0, Math.min(cap, Number.isFinite(res.confidence) ? res.confidence : 0));
  const sameAsRules = res.docType === classification.docType;
  return {
    docType: res.docType,
    confidence: round3(sameAsRules ? Math.max(classification.confidence, aiConf) : aiConf),
    uncertain: true,
    evidence: [...res.evidence.map((e) => `${AI_EVIDENCE_PREFIX}${e}`), `${AI_EVIDENCE_PREFIX}hook-suggested:${res.docType}`, ...classification.evidence.map((e) => `rules:${e}`)],
  };
}
