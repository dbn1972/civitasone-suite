import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normaliseFrameworks,
  normaliseQuestions,
  normaliseScoreRules,
  normaliseScoreHistory,
  normaliseReasonCodes,
  normaliseOutcome,
  reasonCodesForStatus,
  saveClassification,
  qualifyLead,
  transitionLead,
  getScoreRules,
  getFrameworks,
  createFramework,
  updateFramework,
  deleteFramework,
  saveScoreRules,
  getScoreHistory,
  getReasonCodes,
  saveReasonCodes,
  type LeadReasonCode,
} from "./leadQualification";

describe("leadQualification normalisers", () => {
  it("normaliseQuestions drops entries without text and coerces weight", () => {
    const out = normaliseQuestions([
      { text: "Budget?", weight: "3", options: [{ label: "Y", value: "y", score: "10" }] },
      { weight: 2 },
      "junk",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "Budget?", weight: 3 });
    expect(out[0].options?.[0]).toMatchObject({ value: "y", score: 10 });
  });

  it("normaliseFrameworks accepts bare array, {frameworks} and {data} envelopes", () => {
    const shape = [{ name: "GovSales", businessLine: "gov", questions: [{ text: "Q", weight: 1 }] }];
    expect(normaliseFrameworks(shape)).toHaveLength(1);
    expect(normaliseFrameworks({ frameworks: shape })).toHaveLength(1);
    expect(normaliseFrameworks({ data: shape })).toHaveLength(1);
    expect(normaliseFrameworks(null)).toEqual([]);
  });

  it("normaliseFrameworks defaults active true unless explicitly false", () => {
    const [a] = normaliseFrameworks([{ name: "A", businessLine: "x", active: false, questions: [] }]);
    const [b] = normaliseFrameworks([{ name: "B", businessLine: "x", questions: [] }]);
    expect(a.active).toBe(false);
    expect(b.active).toBe(true);
  });

  it("normaliseScoreRules coerces numbers, defaults fn to linear, drops attribute-less rows", () => {
    const out = normaliseScoreRules([
      { attribute: "industry", weight: "5", scoreFnType: "step", params: { a: 1 } },
      { attribute: "x", scoreFnType: "bogus" },
      { weight: 1 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ attribute: "industry", weight: 5, scoreFnType: "step" });
    expect(out[1].scoreFnType).toBe("linear");
  });

  it("normaliseScoreRules reads {rules} envelope and enabled default", () => {
    const out = normaliseScoreRules({ rules: [{ attribute: "a", enabled: false }] });
    expect(out[0].enabled).toBe(false);
  });

  it("normaliseScoreHistory maps factors and numeric fields", () => {
    const out = normaliseScoreHistory([
      { score: 80, previousScore: 60, factors: ["email opened", 5], source: "engine", reason: "activity", scoredAt: "2026-08-01" },
    ]);
    expect(out[0]).toMatchObject({ score: 80, previousScore: 60, source: "engine" });
    expect(out[0].factors).toEqual(["email opened", "5"]);
  });

  it("normaliseReasonCodes drops code-less rows and defaults label/active", () => {
    const out = normaliseReasonCodes([
      { code: "BUDGET", appliesToStatus: "disqualified" },
      { label: "x" },
      { code: "SPAM", label: "Spam", active: false, appliesToStatus: "disqualified" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe("BUDGET");
    expect(out[1].active).toBe(false);
  });

  it("normaliseOutcome falls back to unknown", () => {
    expect(normaliseOutcome(null)).toEqual({ outcome: "unknown", score: 0 });
    expect(normaliseOutcome({ outcome: "qualified", score: 42 })).toEqual({ outcome: "qualified", score: 42 });
  });

  it("reasonCodesForStatus filters by active + matching/unscoped status", () => {
    const codes: LeadReasonCode[] = [
      { code: "A", label: "A", appliesToStatus: "disqualified", active: true },
      { code: "B", label: "B", appliesToStatus: "qualified", active: true },
      { code: "C", label: "C", appliesToStatus: "", active: true },
      { code: "D", label: "D", appliesToStatus: "disqualified", active: false },
    ];
    const out = reasonCodesForStatus(codes, "disqualified").map((c) => c.code);
    expect(out).toEqual(["A", "C"]);
  });
});

describe("leadQualification client calls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // browserClient reads sessionStorage / device id; jsdom provides them.
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saveClassification PATCHes the classification endpoint", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await saveClassification("c1", { temperature: "hot", expectedValueMinor: "15000" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/contacts/c1/classification");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toMatchObject({ temperature: "hot", expectedValueMinor: "15000" });
  });

  it("saveClassification forwards explicit null to clear a field", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await saveClassification("c1", { temperature: null, priority: null, segment: null, expectedValueMinor: null });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // JSON.stringify keeps null keys (unlike undefined), so the backend clears them.
    expect(body).toEqual({ temperature: null, priority: null, segment: null, expectedValueMinor: null });
  });

  it("transitionLead returns accepted=true on a 202 and accepted=false on a 200", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) });
    expect(await transitionLead("l1", { targetStatus: "qualified", reasonCode: "X" })).toEqual({ accepted: true });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    expect(await transitionLead("l1", { targetStatus: "qualified", reasonCode: "X" })).toEqual({ accepted: false });
  });

  it("transitionLead omits reasonCode when none is supplied (free-text-only path)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await transitionLead("l1", { targetStatus: "contacted", reason: "voicemail" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ targetStatus: "contacted", reason: "voicemail" });
  });

  it("qualifyLead posts and normalises the outcome", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ outcome: "qualified", score: 88 }) });
    const out = await qualifyLead("l1", { frameworkId: "f1", answers: { q1: "y" } });
    expect(out).toEqual({ outcome: "qualified", score: 88 });
  });

  it("transitionLead surfaces the server error code+message on failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      clone: () => ({ json: async () => ({ code: "INVALID_TRANSITION", message: "not allowed" }) }),
    });
    await expect(transitionLead("l1", { targetStatus: "qualified", reasonCode: "X" })).rejects.toThrow(
      /INVALID_TRANSITION: not allowed/,
    );
  });

  it("getScoreRules returns source=error on a non-ok response instead of fabricating data", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const res = await getScoreRules();
    expect(res).toEqual({ data: [], source: "error" });
  });

  it("getScoreRules returns source=error when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await getScoreRules()).toEqual({ data: [], source: "error" });
  });
});

describe("leadQualification framework + rule + reason CRUD calls", () => {
  const fetchMock = vi.fn();
  const ok = { ok: true, json: async () => ({}) };
  const fail = { ok: false, status: 400, clone: () => ({ json: async () => ({ code: "BAD", message: "no" }) }) };
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("getFrameworks fetches (with businessLine) and normalises on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ([{ name: "F", businessLine: "gov", questions: [] }]) });
    const res = await getFrameworks("gov");
    expect(res.source).toBe("api");
    expect(res.data[0].name).toBe("F");
    expect(fetchMock.mock.calls[0][0]).toContain("businessLine=gov");
  });

  it("getFrameworks maps a non-ok response to source=error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect((await getFrameworks()).source).toBe("error");
  });

  it("createFramework POSTs and throws the server error on failure", async () => {
    fetchMock.mockResolvedValueOnce(ok);
    await createFramework({ name: "F", businessLine: "gov", active: true, questions: [] });
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    fetchMock.mockResolvedValueOnce(fail);
    await expect(createFramework({ name: "F", businessLine: "gov", active: true, questions: [] })).rejects.toThrow(/BAD: no/);
  });

  it("updateFramework PUTs to the id path", async () => {
    fetchMock.mockResolvedValue(ok);
    await updateFramework("f1", { id: "f1", name: "F", businessLine: "gov", active: true, questions: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/crm/qualification-frameworks/f1");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
  });

  it("deleteFramework DELETEs the id path", async () => {
    fetchMock.mockResolvedValue(ok);
    await deleteFramework("f1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("saveScoreRules PUTs a { rules } envelope", async () => {
    fetchMock.mockResolvedValue(ok);
    await saveScoreRules([{ attribute: "a", weight: 1, scoreFnType: "linear", params: {}, enabled: true }]);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty("rules");
  });

  it("getScoreHistory normalises on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ([{ score: 10, previousScore: 0 }]) });
    const res = await getScoreHistory("l1");
    expect(res.source).toBe("api");
    expect(res.data[0].score).toBe(10);
  });

  it("getReasonCodes normalises on success and errors are safe", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ([{ code: "X", appliesToStatus: "disqualified" }]) });
    expect((await getReasonCodes()).data[0].code).toBe("X");
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await getReasonCodes()).source).toBe("error");
  });

  it("saveReasonCodes PUTs a { codes } envelope and throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(ok);
    await saveReasonCodes([{ code: "X", label: "X", appliesToStatus: "", active: true }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty("codes");
    fetchMock.mockResolvedValueOnce(fail);
    await expect(saveReasonCodes([])).rejects.toThrow(/BAD: no/);
  });

  it("saveClassification throws the server error on failure", async () => {
    fetchMock.mockResolvedValue(fail);
    await expect(saveClassification("c1", { temperature: "hot" })).rejects.toThrow(/BAD: no/);
  });
});
