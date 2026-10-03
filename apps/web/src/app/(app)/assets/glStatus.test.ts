import { describe, it, expect } from "vitest";
import { glErrorKey, journalKey, journalState } from "./glStatus";

describe("glStatus (fp-assets-01)", () => {
  it("maps the GL-heads codes to translation keys and nothing else", () => {
    expect(glErrorKey("GL_HEADS_NOT_CONFIGURED")).toBe("glHeadsNotConfigured");
    expect(glErrorKey("GL_HEAD_INVALID")).toBe("glHeadInvalid");
    expect(glErrorKey("FINANCE_UNAVAILABLE")).toBe("financeUnavailable");
    expect(glErrorKey("JOURNAL_NOT_FAILED")).toBe("journalNotFailed");
    expect(glErrorKey("MAKER_CHECKER")).toBeNull();
    expect(glErrorKey(null)).toBeNull();
    expect(glErrorKey("constructor")).toBeNull();
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
