import { describe, it, expect } from "vitest";
import { validateDakForm, dakLookupTerm, DAK_SEARCH_MAX, EMPTY_DAK_FORM } from "./dakForm";

const TODAY = "2026-10-15";
const UUID = "3f9a1c2e-1111-4222-8333-444455556666";

describe("validateDakForm (GAP-ESTAB-DAK-03)", () => {
  it("Given only sender and subject, Then the payload carries just those two keys", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: " Home Ministry ", subject: " Memo " }, TODAY);
    expect(r).toEqual({ ok: true, payload: { fromAddress: "Home Ministry", subject: "Memo" } });
  });

  it("Given every optional field, Then the payload uses the service's keys and omits blanks", () => {
    const r = validateDakForm(
      { dakNo: "", fromAddress: "A", subject: "B", mode: "hand", receivedDate: "2026-10-14", urgency: "urgent", assignedTo: UUID, sourceSection: "Accounts" },
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      payload: { fromAddress: "A", subject: "B", mode: "hand", receivedDate: "2026-10-14", urgency: "urgent", assignedTo: UUID, sourceSection: "Accounts" },
    });
  });

  it("Given a blank sender and subject, Then both are reported with message keys", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: "  ", subject: "" }, TODAY);
    expect(r).toEqual({ ok: false, errors: { fromAddress: "dakErrFromRequired", subject: "dakErrSubjectRequired" } });
  });

  it("Given a received date in the future, Then it is rejected", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: "A", subject: "B", receivedDate: "2026-10-16" }, TODAY);
    expect(r).toEqual({ ok: false, errors: { receivedDate: "dakErrDateFuture" } });
  });

  it("Given today as the received date, Then it is accepted", () => {
    const r = validateDakForm({ ...EMPTY_DAK_FORM, fromAddress: "A", subject: "B", receivedDate: TODAY }, TODAY);
    expect(r.ok).toBe(true);
  });
});

describe("dakLookupTerm (GAP-ESTAB-DAK-03: the register search refuses a term over 100 characters)", () => {
  it("Given a typed DAK number, Then the lookup is by that number", () => {
    expect(dakLookupTerm({ dakNo: "DAK/2026/555", subject: "A very long subject ".repeat(20) })).toBe("DAK/2026/555");
  });

  it("Given no number and a short subject, Then the lookup is by the whole subject", () => {
    expect(dakLookupTerm({ subject: "Fresh memo" })).toBe("Fresh memo");
  });

  it("Given no number and a subject over 100 characters, Then the lookup is its first 100 characters", () => {
    const subject = "Request for the sanction of an advance for the annual conference of the department ".repeat(4);
    expect(subject.length).toBeGreaterThan(DAK_SEARCH_MAX);
    const term = dakLookupTerm({ subject });
    expect(term).toBe(subject.slice(0, DAK_SEARCH_MAX).trim());
    expect((term ?? "").length).toBeLessThanOrEqual(DAK_SEARCH_MAX);
  });

  it("Given a cut that would split a surrogate pair, Then the lone half is dropped so the term can be URL-encoded", () => {
    const subject = `x${"\u{1F600}".repeat(60)}`; // index 99 is the first half of an emoji
    const term = dakLookupTerm({ subject });
    expect(term).not.toBeNull();
    expect(() => encodeURIComponent(term as string)).not.toThrow();
    expect((term as string).length).toBeLessThanOrEqual(DAK_SEARCH_MAX);
  });

  it("Given nothing to search for, Then there is no term (the search refuses an empty one)", () => {
    expect(dakLookupTerm({})).toBeNull();
    expect(dakLookupTerm({ dakNo: "  ", subject: "   " })).toBeNull();
  });
});
