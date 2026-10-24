/** Pure (no-DB) unit tests for the engagement mappers and survey-answer validation. */
import { describe, it, expect } from "vitest";
import {
  alertDisplayStatus, formatCompletion, formatSurveyPeriod, toNoticeDto, NOTICE_TYPE_LABELS,
} from "../src/modules/engagement/mappers.js";
import { validateAnswers, createSurveyBody, createAlertBody } from "../src/modules/engagement/validators.js";
import { resolveStatuses, PUBLIC_STATUSES } from "../src/modules/engagement/queries.js";
import type { SurveyQuestion, CitizenNoticeRow } from "../src/modules/engagement/schema.js";

describe("alertDisplayStatus", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  it("derives expired only for a stored-active alert past its expiry", () => {
    expect(alertDisplayStatus({ status: "active", expiresAt: new Date("2026-10-23T00:00:00Z") }, now)).toBe("expired");
    expect(alertDisplayStatus({ status: "active", expiresAt: new Date("2026-10-25T00:00:00Z") }, now)).toBe("active");
    expect(alertDisplayStatus({ status: "active", expiresAt: null }, now)).toBe("active");
    expect(alertDisplayStatus({ status: "draft", expiresAt: new Date("2020-01-01") }, now)).toBe("draft");
    expect(alertDisplayStatus({ status: "withdrawn", expiresAt: new Date("2020-01-01") }, now)).toBe("withdrawn");
  });
});

describe("survey presentation helpers", () => {
  it("completion is responses/target capped at 100%, '—' without a target", () => {
    expect(formatCompletion(1, 4)).toBe("25%");
    expect(formatCompletion(9, 4)).toBe("100%");
    expect(formatCompletion(3, null)).toBe("—");
    expect(formatCompletion(3, 0)).toBe("—");
  });
  it("period", () => {
    expect(formatSurveyPeriod("2026-10-01", "2026-10-31")).toBe("01 Oct 2026 – 31 Oct 2026");
    expect(formatSurveyPeriod("2026-10-01", null)).toBe("From 01 Oct 2026");
    expect(formatSurveyPeriod(null, "2026-12-05")).toBe("Until 05 Dec 2026");
    expect(formatSurveyPeriod(null, null)).toBe("");
  });
});

describe("notice type labels match the strings NoticesTable counts on", () => {
  it("Statutory / Public Hearing / Tender", () => {
    expect(NOTICE_TYPE_LABELS).toMatchObject({ statutory: "Statutory", public_hearing: "Public Hearing", tender: "Tender" });
    const row = { id: "i", noticeNo: "N", subject: "s", department: "d", noticeType: "tender", publishedAt: null, expiresAt: null } as unknown as CitizenNoticeRow;
    expect(toNoticeDto(row)).toMatchObject({ type: "Tender", published: "", expiry: "" });
  });
});

describe("validateAnswers", () => {
  const qs: SurveyQuestion[] = [
    { id: "r", text: "rate", type: "rating", required: true },
    { id: "s", text: "one", type: "single_choice", options: ["a", "b"] },
    { id: "m", text: "many", type: "multi_choice", options: ["x", "y", "z"] },
    { id: "t", text: "free", type: "text" },
  ];
  it("accepts a fully valid and a minimal answer set", () => {
    expect(validateAnswers(qs, { r: 3, s: "a", m: ["x", "z"], t: "ok" })).toEqual([]);
    expect(validateAnswers(qs, { r: 1 })).toEqual([]);
  });
  it("rejects missing-required, out-of-range, non-option, wrong-type, unknown keys", () => {
    expect(validateAnswers(qs, {})).toHaveLength(1);
    expect(validateAnswers(qs, { r: 0 })).toHaveLength(1);
    expect(validateAnswers(qs, { r: 2.5 })).toHaveLength(1);
    expect(validateAnswers(qs, { r: 2, s: "c" })).toHaveLength(1);
    expect(validateAnswers(qs, { r: 2, m: ["x", "q"] })).toHaveLength(1);
    expect(validateAnswers(qs, { r: 2, t: 5 })).toHaveLength(1);
    expect(validateAnswers(qs, { r: 2, nope: "x" })).toHaveLength(1);
  });
});

describe("request validators", () => {
  it("createSurveyBody rejects duplicate ids and choice questions without two options", () => {
    const base = { surveyName: "s" };
    expect(createSurveyBody.safeParse({ ...base, questions: [{ id: "a", text: "t", type: "text" }, { id: "a", text: "u", type: "text" }] }).success).toBe(false);
    expect(createSurveyBody.safeParse({ ...base, questions: [{ id: "a", text: "t", type: "single_choice", options: ["only"] }] }).success).toBe(false);
    expect(createSurveyBody.safeParse({ ...base, questions: [{ id: "a", text: "t", type: "single_choice", options: ["p", "q"] }] }).success).toBe(true);
  });
  it("createAlertBody neutralises a leading formula character (CSV-injection guard) and rejects past expiry", () => {
    expect(createAlertBody.parse({ title: "=SUM(A1)" }).title).toBe("'=SUM(A1)");
    expect(createAlertBody.safeParse({ title: "t", expiresAt: "2020-01-01T00:00:00Z" }).success).toBe(false);
  });
});

describe("resolveStatuses — who may see what", () => {
  it("a bare citizen is forced to the public set regardless of the requested filter", () => {
    expect(resolveStatuses("alerts", false, "draft")).toEqual([...PUBLIC_STATUSES.alerts]);
    expect(resolveStatuses("notices", false, "all")).toEqual(["published"]);
    expect(resolveStatuses("surveys", false)).toEqual(["active", "completed"]);
  });
  it("staff defaults: alerts/surveys all, notices published; ?status picks one or all", () => {
    expect(resolveStatuses("alerts", true)).toBeNull();
    expect(resolveStatuses("surveys", true)).toBeNull();
    expect(resolveStatuses("notices", true)).toEqual(["published"]);
    expect(resolveStatuses("notices", true, "draft")).toEqual(["draft"]);
    expect(resolveStatuses("notices", true, "all")).toBeNull();
  });
});
