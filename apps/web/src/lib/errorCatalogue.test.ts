import { describe, it, expect } from "vitest";
import {
  ERROR_CATALOGUE,
  DOMAIN_CODE_MESSAGES,
  DUPLICATE_RECORD_MESSAGE,
  resolveHumanError,
  statusToKind,
  formatReference,
  referenceFromHeaders,
  type ErrorStatusKind,
} from "./errorCatalogue";
import { findBannedTerms } from "./labels";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const KINDS = Object.keys(ERROR_CATALOGUE.en.kinds) as ErrorStatusKind[];

describe("error catalogue: en/hi parity", () => {
  it("hi has every kind en has, with matching placeholders", () => {
    expect(Object.keys(ERROR_CATALOGUE.hi.kinds).sort()).toEqual([...KINDS].sort());
    for (const k of KINDS) {
      const en = ERROR_CATALOGUE.en.kinds[k];
      const hi = ERROR_CATALOGUE.hi.kinds[k];
      expect(placeholders(hi.what), `${k}.what`).toEqual(placeholders(en.what));
      expect(placeholders(hi.next), `${k}.next`).toEqual(placeholders(en.next));
      expect(Boolean(hi.nextRead), `${k}.nextRead`).toBe(Boolean(en.nextRead));
      expect(hi.what.trim()).not.toBe("");
      expect(hi.what).not.toBe(en.what);
    }
  });

  it("hi has every verb and the reference label", () => {
    expect(Object.keys(ERROR_CATALOGUE.hi.verbs).sort()).toEqual(Object.keys(ERROR_CATALOGUE.en.verbs).sort());
    expect(ERROR_CATALOGUE.hi.referenceLabel).not.toBe(ERROR_CATALOGUE.en.referenceLabel);
  });

  it("every domain code has en and hi copy with matching placeholders", () => {
    for (const [code, m] of Object.entries(DOMAIN_CODE_MESSAGES)) {
      expect(m.hi.what, code).toBeTruthy();
      expect(placeholders(m.hi.what)).toEqual(placeholders(m.en.what));
      expect(placeholders(m.hi.next)).toEqual(placeholders(m.en.next));
    }
  });
});

describe("error catalogue: standard wording", () => {
  const sample = (status: number | undefined) =>
    resolveHumanError({ status, ctx: { area: "leave request", intent: "save", limit: "5 MB", types: "PDF", locale: "en" } });
  const text = (status: number | undefined) => {
    const r = sample(status);
    return `${r.what} ${r.next}`;
  };

  it.each([
    [400, "Some details weren't accepted. Check what you entered and try again."],
    [422, "Some details weren't accepted. Check what you entered and try again."],
    [401, "Your session has ended. Sign in again to continue."],
    [403, "You don't have permission to do this. Ask your administrator if you need access."],
    [404, "We couldn't find this leave request. It may have been removed or the link may be wrong."],
    [409, "This leave request was changed by someone else. Refresh to see the latest version, then try again."],
    [413, "The file is too large. Upload a file smaller than 5 MB."],
    [415, "This file type isn't accepted. Upload a PDF file."],
    [429, "Too many attempts. Wait a minute, then try again."],
    [500, "We couldn't save the leave request because of a problem on our side. Your changes haven't been saved. Try again in a few minutes."],
    [503, "We couldn't save the leave request because of a problem on our side. Your changes haven't been saved. Try again in a few minutes."],
    [undefined, "We couldn't connect. Check your internet connection and try again."],
    [504, "We couldn't connect. Check your internet connection and try again."],
  ])("status %s", (status, expected) => {
    expect(text(status as number | undefined)).toBe(expected);
  });

  it("a load failure on 5xx does not claim changes were lost", () => {
    const r = resolveHumanError({ status: 500, ctx: { area: "payslips", intent: "load", locale: "en" } });
    expect(r.what).toBe("We couldn't load the payslips because of a problem on our side.");
    expect(r.next).toBe("Try again in a few minutes.");
  });

  it("offers sign in for 401 and no retry for 403", () => {
    expect(sample(401).actions).toEqual(["signin"]);
    expect(sample(403).actions).not.toContain("retry");
  });

  it("a known domain code wins over the generic status copy", () => {
    const r = resolveHumanError({ status: 409, code: "SELF_APPROVAL_FORBIDDEN", ctx: { locale: "en" } });
    expect(`${r.what} ${r.next}`).toBe("You can't approve your own request. Another approver needs to do this.");
    const s = resolveHumanError({ status: 409, code: "STALE_ELECTION", ctx: { locale: "en" } });
    expect(s.what).toBe("This election was changed by someone else.");
  });

  it.each(["SELF_APPROVAL", "SELF_APPROVAL_FORBIDDEN", "SELF_APPROVAL_DENIED", "FNF_SELF_APPROVAL_FORBIDDEN"])(
    "%s (every self-approval code the services emit) gets the self-approval copy",
    (code) => {
      const r = resolveHumanError({ status: 403, code, ctx: { locale: "en" } });
      expect(`${r.what} ${r.next}`).toBe("You can't approve your own request. Another approver needs to do this.");
    },
  );

  it.each(["MAKER_CHECKER", "MAKER_CHECKER_VIOLATION"])("%s says a different person must approve", (code) => {
    const r = resolveHumanError({ status: 409, code, ctx: { locale: "en" } });
    expect(r.what).toBe("This needs approval from someone other than the person who made it.");
    expect(r.next).toBe("Another approver needs to do this.");
  });

  it("an unclassified thrown error (no status, kind unknown) is honest about the cause", () => {
    const w = resolveHumanError({ forceKind: "unknown", ctx: { area: "leave request", intent: "save", locale: "en" } });
    expect(`${w.what} ${w.next}`).toBe(
      "We couldn't save the leave request. Your changes haven't been saved. Check your internet connection and try again in a few minutes.",
    );
    const r = resolveHumanError({ forceKind: "unknown", ctx: { area: "payslips", intent: "load", locale: "en" } });
    expect(`${r.what} ${r.next}`).toBe("We couldn't load the payslips. Check your internet connection and try again in a few minutes.");
  });

  it("400 with field errors points at the highlighted fields; without them it is action-neutral", () => {
    const withFields = resolveHumanError({ status: 400, ctx: { locale: "en", hasFieldErrors: true } });
    expect(`${withFields.what} ${withFields.next}`).toBe("Some details need changing. Check the highlighted fields and try again.");
    const without = resolveHumanError({ status: 422, ctx: { locale: "en" } });
    expect(`${without.what} ${without.next}`).toBe("Some details weren't accepted. Check what you entered and try again.");
    expect(without.next).not.toMatch(/highlighted/);
  });

  it("hi has the neutral validation variant too", () => {
    expect(ERROR_CATALOGUE.hi.kinds.validation.neutral).toBeTruthy();
    expect(ERROR_CATALOGUE.en.kinds.validation.neutral).toBeTruthy();
  });

  it.each([
    ["SELF_DISBURSE_FORBIDDEN", "You can't disburse a loan you created."],
    ["SELF_REVIEW_FORBIDDEN", "You can't review your own appraisal."],
    ["STALE_OVERRIDE", "This application changed after the override was raised."],
    ["STALE_VERSION", "This record was changed by someone else."],
  ])("%s has its own specific copy", (code, what) => {
    const r = resolveHumanError({ status: 409, code, ctx: { locale: "en" } });
    expect(r.what).toBe(what);
  });

  it.each(["DUPLICATE_PAN", "DUPLICATE_BILL", "DUPLICATE_REGISTRATION", "DUPLICATE_RUN_FOR_PERIOD", "DUPLICATE_KEY"])(
    "%s (409) reads as a duplicate, not 'changed by someone else', and the code is not echoed",
    (code) => {
      const r = resolveHumanError({ status: 409, code, ctx: { locale: "en", area: "vendor" } });
      expect(`${r.what} ${r.next}`).toBe(
        "A vendor with these details already exists. Check the existing record, or change the details and try again.",
      );
      expect(`${r.what} ${r.next}`).not.toContain(code);
      expect(`${r.what} ${r.next}`).not.toMatch(/changed by someone else/);
    },
  );

  it("DUPLICATE_CODE keeps its more specific copy", () => {
    expect(resolveHumanError({ status: 409, code: "DUPLICATE_CODE", ctx: { locale: "en" } }).what).toBe("This code is already in use.");
  });

  it("the duplicate copy exists in hi with matching placeholders, and renders", () => {
    const { en, hi } = DUPLICATE_RECORD_MESSAGE;
    expect(placeholders(hi.what)).toEqual(placeholders(en.what));
    expect(placeholders(hi.next)).toEqual(placeholders(en.next));
    const r = resolveHumanError({ status: 409, code: "DUPLICATE_PAN", ctx: { locale: "hi", area: "vendor" } });
    expect(r.what).toBe("इन विवरणों वाला vendor पहले से मौजूद है।");
  });

  it("an unknown code falls back to the status copy and is never echoed", () => {
    const r = resolveHumanError({ status: 409, code: "TOTALLY_NEW_CODE", ctx: { locale: "en" } });
    expect(r.what).toBe("This information was changed by someone else.");
    expect(`${r.what} ${r.next}`).not.toContain("TOTALLY_NEW_CODE");
  });

  it("renders Hindi when asked", () => {
    const r = resolveHumanError({ status: 403, ctx: { locale: "hi" } });
    expect(r.what).toBe(ERROR_CATALOGUE.hi.kinds.forbidden.what);
    expect(r.what).not.toMatch(/permission/i);
  });

  it.each(["en", "hi"] as const)("%s: no status number, banned term, or banned phrase in any message", (locale) => {
    const banned = /\b(oops|invalid|failed to|something went wrong)\b/i;
    const all = [
      ...Object.values(ERROR_CATALOGUE[locale].kinds).flatMap((e) => [e.what, e.next, e.nextRead ?? ""]),
      ...Object.values(DOMAIN_CODE_MESSAGES).flatMap((m) => [m[locale].what, m[locale].next]),
    ];
    for (const copy of all) {
      expect(findBannedTerms(copy), copy).toEqual([]);
      expect(/\b[1-5]\d\d\b/.test(copy), copy).toBe(false);
      expect(banned.test(copy), copy).toBe(false);
    }
  });

  it("every message is one or two short sentences", () => {
    for (const k of KINDS) {
      const e = ERROR_CATALOGUE.en.kinds[k];
      expect(e.what.endsWith(".")).toBe(true);
      expect(e.what.split(/\.\s/).length).toBe(1);
    }
  });

  it("maps statuses to kinds", () => {
    expect(statusToKind(418)).toBe("server");
    expect(statusToKind(0)).toBe("network");
    expect(statusToKind(412)).toBe("conflict");
  });
});

describe("support reference", () => {
  it("formats a localised, secondary reference line", () => {
    expect(formatReference("ab12-CD", "en")).toBe("Reference: ab12-CD");
    expect(formatReference("ab12-CD", "hi")).toBe(`${ERROR_CATALOGUE.hi.referenceLabel}: ab12-CD`);
    expect(formatReference(null, "en")).toBe("");
  });

  it("reads only short opaque ids from the response headers", () => {
    const h = (v: string) => new Headers({ "x-request-id": v });
    expect(referenceFromHeaders(h("req_12345"))).toBe("req_12345");
    expect(referenceFromHeaders(h("Error: stack trace at foo"))).toBeNull();
    expect(referenceFromHeaders(new Headers({ "x-correlation-id": "c0ffee-1234" }))).toBe("c0ffee-1234");
    expect(referenceFromHeaders(undefined)).toBeNull();
  });
});
