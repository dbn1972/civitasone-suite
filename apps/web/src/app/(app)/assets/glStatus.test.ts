import { describe, it, expect } from "vitest";
import { glErrorKey, journalKey, journalState, journalTone } from "./glStatus";

describe("glStatus (fp-assets-01)", () => {
  it("maps the GL-heads codes to translation keys and nothing else", () => {
    expect(glErrorKey("ASSET_GL_NOT_CONFIGURED")).toBe("glHeadsNotConfigured");
    expect(glErrorKey("GL_HEAD_INVALID")).toBe("glHeadInvalid");
    expect(glErrorKey("FINANCE_UNAVAILABLE")).toBe("financeUnavailable");
    expect(glErrorKey("JOURNAL_NOT_FAILED")).toBe("journalNotFailed");
    expect(glErrorKey("MAKER_CHECKER")).toBeNull();
    expect(glErrorKey(null)).toBeNull();
    expect(glErrorKey("constructor")).toBeNull();
  });
  it("knows the deferred state: awaiting accounts is its own label and a warning tone", () => {
    expect(journalState("awaiting_accounts")).toBe("awaiting_accounts");
    expect(journalKey("awaiting_accounts")).toBe("journalAwaiting");
    expect(journalTone("awaiting_accounts")).toBe("warn");
    expect(journalTone("posted")).toBe("good");
    expect(journalTone("failed")).toBe("bad");
    expect(journalTone("pending")).toBe("warn");
  });
  it("reads an unknown journal state as none", () => {
    expect(journalState("pending")).toBe("pending");
    expect(journalState("posted")).toBe("posted");
    expect(journalState("failed")).toBe("failed");
    expect(journalState(undefined)).toBe("none");
    expect(journalState("weird")).toBe("none");
    expect(journalKey("failed")).toBe("journalFailed");
    expect(journalKey("none")).toBe("journalNone");
  });
});

describe("rejectionNote (finance refusals, fp-assets-02)", () => {
  it("a closed period says it needs a date in an open period and is not re-dated; non-leaf and unknown account have their own advice", async () => {
    const { rejectionNote } = await import("./glStatus");
    expect(rejectionNote("PERIOD_CLOSED: the period 2026-08 is closed")).toEqual({ key: "rejectPeriodClosed", reason: "the period 2026-08 is closed" });
    expect(rejectionNote("PERIOD_SOFT_CLOSED: closed for posting")?.key).toBe("rejectPeriodClosed");
    expect(rejectionNote("NOT_LEAF_ACCOUNT: 2050 is a group account")?.key).toBe("rejectNotLeaf");
    expect(rejectionNote("UNKNOWN_ACCOUNT_CODE: account 9999 not found")?.key).toBe("rejectUnknownAccount");
    expect(rejectionNote("something odd")).toEqual({ key: "rejectGeneric", reason: "something odd" });
    expect(rejectionNote(null)).toBeNull();
    expect(rejectionNote("  ")).toBeNull();
  });
});
