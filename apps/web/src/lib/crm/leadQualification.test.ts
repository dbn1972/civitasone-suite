import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UserFacingError } from "@/lib/userFacingError";
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
  frameworkToWire,
  FrameworkConflictError,
  QuestionHasAnswersError,
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

  it("normaliseScoreRules coerces numbers, defaults fn to presence, drops attribute-less rows", () => {
    const out = normaliseScoreRules([
      { attribute: "industry", weight: "5", scoreFnType: "map", params: { a: 1 } },
      { attribute: "x", scoreFnType: "bogus" },
      { weight: 1 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ attribute: "industry", weight: 5, scoreFnType: "map" });
    expect(out[1].scoreFnType).toBe("presence");
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

  // GAP-CRM-QUALIFICATION-FRAMEWORKS-02 (web half): version + question ids on PUT, 409 handling.
  it("normaliseFrameworks keeps the server version, and questions accept the server's prompt field", () => {
    const [fw] = normaliseFrameworks([
      { id: "f1", name: "BANT", businessLine: "gov", version: 4, questions: [{ id: "q1", prompt: "Budget?", weight: 3 }] },
    ]);
    expect(fw.version).toBe(4);
    expect(fw.questions[0]).toMatchObject({ id: "q1", text: "Budget?", weight: 3 });
  });

  it("updateFramework PUTs the version and each existing question id in the server's wire shape", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await updateFramework("f1", {
      id: "f1", name: "BANT", businessLine: "gov", active: true, version: 7,
      questions: [{ id: "q1", text: "Budget?", weight: 2 }, { text: "New one", weight: 1 }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.version).toBe(7);
    expect(body.questions[0]).toMatchObject({ id: "q1", prompt: "Budget?", weight: 2, order: 0 });
    expect(body.questions[1]).not.toHaveProperty("id");
    expect(body.questions[1]).toMatchObject({ prompt: "New one", order: 1 });
  });

  it("updateFramework maps 409 VERSION_CONFLICT to a plain-language reload message", async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 409,
      clone: () => ({ json: async () => ({ code: "VERSION_CONFLICT", message: "x" }) }),
    });
    const fw = { id: "f1", name: "A", businessLine: "g", active: true, version: 1, questions: [] };
    await expect(updateFramework("f1", fw)).rejects.toBeInstanceOf(FrameworkConflictError);
    await expect(updateFramework("f1", fw)).rejects.toThrow(/changed by someone else/i);
  });

  it("updateFramework maps 409 QUESTION_HAS_ANSWERS to an in-use message", async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 409,
      clone: () => ({ json: async () => ({ code: "QUESTION_HAS_ANSWERS", message: "x" }) }),
    });
    await expect(
      updateFramework("f1", { id: "f1", name: "A", businessLine: "g", active: true, questions: [] }),
    ).rejects.toBeInstanceOf(QuestionHasAnswersError);
  });

  it("create/updateFramework throw a UserFacingError (clerk-safe message + support reference) on a non-409 failure", async () => {
    const failing = {
      ok: false, status: 500,
      headers: new Headers({ "x-correlation-id": "REF-1234" }),
      clone: () => ({ json: async () => ({ code: "INTERNAL", message: "stack trace boom" }) }),
    };
    const fw = { id: "f1", name: "A", businessLine: "g", active: true, questions: [] };
    fetchMock.mockResolvedValue(failing);
    for (const call of [() => createFramework(fw), () => updateFramework("f1", fw)]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserFacingError);
      expect((err as Error).message).not.toMatch(/boom|INTERNAL|500/);
    }
  });

  it("frameworkToWire emits a select question with an option score map", () => {
    const w = frameworkToWire({
      name: "A", businessLine: "g", active: true,
      questions: [{ text: "Size?", weight: 1, options: [{ label: "Big", value: "big", score: 90 }] }],
    }) as { questions: Array<Record<string, unknown>> };
    expect(w.questions[0]).toMatchObject({ answerType: "select", outcomeRule: { options: { big: 90 } } });
  });

  it("qualifyLead posts and normalises the outcome", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ outcome: "qualified", score: 88 }) });
    const out = await qualifyLead("l1", { frameworkId: "f1", answers: { q1: "y" } });
    expect(out).toEqual({ outcome: "qualified", score: 88 });
  });

  it("transitionLead throws a clerk-safe message on failure, never the server's raw code+message (UX-020)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      clone: () => ({ json: async () => ({ code: "INVALID_TRANSITION", message: "not allowed" }) }),
    });
    await expect(transitionLead("l1", { targetStatus: "qualified", reasonCode: "X" })).rejects.toThrow(
      "This information was changed by someone else. Refresh to see the latest version, then try again.",
    );
    await expect(transitionLead("l1", { targetStatus: "qualified", reasonCode: "X" })).rejects.not.toThrow(
      /INVALID_TRANSITION|not allowed/,
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

  // GAP-CRM-QUALIFICATION-FRAMEWORKS-04: the businessLine query is normalised
  // (trim + lowercase) so a lead's "Government " still matches a framework
  // stored as "government".
  it("getFrameworks lowercases and trims the businessLine query", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ([]) });
    await getFrameworks("  Government ");
    expect(fetchMock.mock.calls[0][0]).toContain("businessLine=government");
    expect(fetchMock.mock.calls[0][0]).not.toContain("Government");
  });

  it("createFramework POSTs and throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValueOnce(ok);
    await createFramework({ name: "F", businessLine: "gov", active: true, questions: [] });
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    fetchMock.mockResolvedValueOnce(fail);
    await expect(createFramework({ name: "F", businessLine: "gov", active: true, questions: [] })).rejects.toThrow(
      "Some details weren't accepted. Check what you entered and try again.",
    );
    fetchMock.mockResolvedValueOnce(fail);
    await expect(
      createFramework({ name: "F", businessLine: "gov", active: true, questions: [] }),
    ).rejects.not.toThrow(/BAD/);
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
    await saveScoreRules([{ attribute: "a", weight: 1, scoreFnType: "presence", params: {}, enabled: true }]);
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

  it("saveReasonCodes PUTs a { codes } envelope and throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValueOnce(ok);
    await saveReasonCodes([{ code: "X", label: "X", appliesToStatus: "", active: true }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty("codes");
    fetchMock.mockResolvedValueOnce(fail);
    await expect(saveReasonCodes([])).rejects.toThrow("Some details weren't accepted. Check what you entered and try again.");
    fetchMock.mockResolvedValueOnce(fail);
    await expect(saveReasonCodes([])).rejects.not.toThrow(/BAD/);
  });

  it("saveClassification throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValue(fail);
    await expect(saveClassification("c1", { temperature: "hot" })).rejects.toThrow("Some details weren't accepted. Check what you entered and try again.");
    await expect(saveClassification("c1", { temperature: "hot" })).rejects.not.toThrow(/BAD/);
  });
});
