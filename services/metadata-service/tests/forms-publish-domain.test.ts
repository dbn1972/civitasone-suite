/**
 * Unit tests for the FRM-07 maker-checker state machine. Every transition,
 * every refusal, and both invariants (separation of duties, immutability of a
 * published version) are covered here without a database.
 */
import { describe, it, expect } from "vitest";
import {
  FORM_VERSION_STATUSES,
  assertEditable,
  canApprove,
  canReject,
  canRevise,
  canSubmit,
  isImmutable,
  nextVersionNumber,
  type FormVersionState,
} from "../src/modules/forms/publish-domain.js";

const MAKER = "11111111-1111-1111-1111-111111111111";
const CHECKER = "22222222-2222-2222-2222-222222222222";

function state(overrides: Partial<FormVersionState> = {}): FormVersionState {
  return { status: "draft", createdBy: MAKER, submittedBy: null, publishedBy: null, ...overrides };
}

describe("status set", () => {
  it("declares exactly the four lifecycle states", () => {
    expect([...FORM_VERSION_STATUSES]).toEqual(["draft", "pending_approval", "published", "superseded"]);
  });

  it("marks published and superseded as immutable, draft and pending as not", () => {
    expect(isImmutable("published")).toBe(true);
    expect(isImmutable("superseded")).toBe(true);
    expect(isImmutable("draft")).toBe(false);
    expect(isImmutable("pending_approval")).toBe(false);
  });
});

describe("immutability (assertEditable)", () => {
  it("allows editing a draft", () => {
    expect(assertEditable(state())).toEqual({ ok: true, next: "draft" });
  });

  it("refuses to edit a PUBLISHED version with 409 VERSION_IMMUTABLE", () => {
    const result = assertEditable(state({ status: "published", publishedBy: CHECKER }));
    expect(result).toMatchObject({ ok: false, status: 409, code: "VERSION_IMMUTABLE" });
    if (!result.ok) expect(result.message).toContain("create a new draft version");
  });

  it("refuses to edit a SUPERSEDED version", () => {
    expect(assertEditable(state({ status: "superseded" }))).toMatchObject({
      ok: false,
      status: 409,
      code: "VERSION_IMMUTABLE",
    });
  });

  it("refuses to edit a version awaiting approval", () => {
    expect(assertEditable(state({ status: "pending_approval", submittedBy: MAKER }))).toMatchObject({
      ok: false,
      status: 409,
      code: "VERSION_PENDING_APPROVAL",
    });
  });
});

describe("submit (draft -> pending_approval)", () => {
  it("allows submitting a draft", () => {
    expect(canSubmit(state())).toEqual({ ok: true, next: "pending_approval" });
  });

  it("refuses to re-submit a version already awaiting approval", () => {
    expect(canSubmit(state({ status: "pending_approval" }))).toMatchObject({
      ok: false,
      status: 409,
      code: "INVALID_STATE",
    });
  });

  it("refuses to submit a published version", () => {
    expect(canSubmit(state({ status: "published" }))).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});

describe("separation of duties (canApprove)", () => {
  it("allows a different actor to approve", () => {
    const result = canApprove(state({ status: "pending_approval", submittedBy: MAKER }), CHECKER);
    expect(result).toEqual({ ok: true, next: "published" });
  });

  it("REFUSES the submitter with 403 MAKER_CANNOT_CHECK", () => {
    const result = canApprove(state({ status: "pending_approval", submittedBy: MAKER }), MAKER);
    expect(result).toMatchObject({ ok: false, status: 403, code: "MAKER_CANNOT_CHECK" });
  });

  it("falls back to createdBy when no submitter was recorded (fail closed)", () => {
    const result = canApprove(state({ status: "pending_approval", submittedBy: null, createdBy: MAKER }), MAKER);
    expect(result).toMatchObject({ ok: false, status: 403, code: "MAKER_CANNOT_CHECK" });
  });

  it("still allows a third actor when no submitter was recorded", () => {
    const result = canApprove(state({ status: "pending_approval", submittedBy: null, createdBy: MAKER }), CHECKER);
    expect(result.ok).toBe(true);
  });

  it("refuses a second approve of an already-published version with 409 ALREADY_PUBLISHED", () => {
    const result = canApprove(state({ status: "published", submittedBy: MAKER, publishedBy: CHECKER }), CHECKER);
    expect(result).toMatchObject({ ok: false, status: 409, code: "ALREADY_PUBLISHED" });
  });

  it("refuses to approve a draft that was never submitted", () => {
    expect(canApprove(state(), CHECKER)).toMatchObject({ ok: false, status: 409, code: "INVALID_STATE" });
  });

  it("refuses to approve a superseded version", () => {
    expect(canApprove(state({ status: "superseded" }), CHECKER)).toMatchObject({
      ok: false,
      code: "INVALID_STATE",
    });
  });
});

describe("reject (pending_approval -> draft)", () => {
  it("allows rejecting a version awaiting approval", () => {
    expect(canReject(state({ status: "pending_approval" }))).toEqual({ ok: true, next: "draft" });
  });

  it("refuses to reject a draft", () => {
    expect(canReject(state())).toMatchObject({ ok: false, status: 409, code: "INVALID_STATE" });
  });

  it("refuses to reject a published version", () => {
    expect(canReject(state({ status: "published" }))).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});

describe("revise (always produces a new draft)", () => {
  it("allows revising a published version — this is how immutability stays workable", () => {
    expect(canRevise(state({ status: "published" }))).toEqual({ ok: true, next: "draft" });
  });

  it("allows revising a draft", () => {
    expect(canRevise(state())).toEqual({ ok: true, next: "draft" });
  });
});

describe("nextVersionNumber", () => {
  it("starts at 1 for a form with no versions", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("takes max + 1, not count + 1", () => {
    expect(nextVersionNumber([1, 2, 7])).toBe(8);
  });

  it("is unaffected by ordering", () => {
    expect(nextVersionNumber([7, 1, 2])).toBe(8);
  });
});
