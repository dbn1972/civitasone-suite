import { describe, it, expect } from "vitest";
import { errorMessageFromResponse, errorMessageForStatus, browserFetch, browserJson, UserFacingError, referenceFromError } from "./browserClient";
import { vi, afterEach } from "vitest";

function mockRes(status: number, body?: unknown, throwOnJson = false, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status < 400,
    headers: new Headers(headers),
    clone() {
      return this;
    },
    async json() {
      if (throwOnJson) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

/**
 * UX-020: errorMessageFromResponse used to return the backend's raw
 * `code`/`message` verbatim (e.g. "ALREADY_CLOSED: period is already
 * hard-closed"), falling back to `API_ERROR: <status>` — the same raw-leak
 * bug class UX-003/UX-016 close in useFormError-based forms. These tests
 * replace the old ones that asserted that verbatim text was the *correct*
 * output (see git history / PR description for the before/after) — the
 * negative assertions below (`.not.toContain`) are the sabotage check: they
 * fail if a future edit reintroduces any raw code/message/status echo.
 */
describe("errorMessageFromResponse", () => {
  it("never echoes the server's raw code+message, even when both are present", async () => {
    const msg = await errorMessageFromResponse(
      mockRes(409, { code: "ALREADY_CLOSED", message: "period is already hard-closed" }),
    );
    expect(msg).not.toContain("ALREADY_CLOSED");
    expect(msg).not.toContain("period is already hard-closed");
    expect(msg).toBe("This information was changed by someone else. Refresh to see the latest version, then try again.");
  });

  it("never echoes a bare message with no code either", async () => {
    const msg = await errorMessageFromResponse(mockRes(400, { message: "IFSC must be exactly 11 characters." }));
    expect(msg).not.toContain("IFSC must be exactly 11 characters.");
    expect(msg).toBe("Some details weren't accepted. Check what you entered and try again.");
  });

  it("never echoes a nested error.{code,message} envelope", async () => {
    const msg = await errorMessageFromResponse(
      mockRes(503, { error: { code: "INTEGRATION_DISABLED", message: "PFMS is offline" } }),
    );
    expect(msg).not.toContain("INTEGRATION_DISABLED");
    expect(msg).not.toContain("PFMS is offline");
    expect(msg).toBe(
      "We couldn't save the information because of a problem on our side. Your changes haven't been saved. Try again in a few minutes.",
    );
  });

  it('never falls back to "API_ERROR: <status>" when the body is absent/unparseable', async () => {
    const msg = await errorMessageFromResponse(mockRes(500, undefined, true));
    expect(msg).not.toContain("API_ERROR");
    expect(msg).not.toContain("500");
    expect(msg).toMatch(/couldn't save/i);
  });

  it("never echoes the raw status when the body has neither code nor message", async () => {
    const msg = await errorMessageFromResponse(mockRes(404, { foo: "bar" }));
    expect(msg).not.toContain("404");
  });

  it("does not echo anything from the body, only uses the code as a lookup key", async () => {
    const msg = await errorMessageFromResponse(mockRes(400, { code: "SHOULD_NEVER_APPEAR", message: "should never appear either" }));
    expect(msg).not.toContain("SHOULD_NEVER_APPEAR");
    expect(msg).not.toContain("should never appear either");
  });

  it("a 400 without field errors is action-neutral; with field errors it points at the highlighted fields", async () => {
    expect(await errorMessageFromResponse(mockRes(400, { message: "x" }))).toBe(
      "Some details weren't accepted. Check what you entered and try again.",
    );
    expect(await errorMessageFromResponse(mockRes(400, { fieldErrors: [{ field: "a", message: "Bad" }] }))).toBe(
      "Some details need changing. Check the highlighted fields and try again.",
    );
  });

  it("maps a 404 to the standard not-found copy, naming the object", async () => {
    const msg = await errorMessageFromResponse(mockRes(404, {}), undefined, "invoice");
    expect(msg).toBe("We couldn't find this invoice. It may have been removed or the link may be wrong.");
  });

  it("still resolves the status internally only to pick the wording, never to display it", async () => {
    const msg = await errorMessageFromResponse(mockRes(404, { message: "Not found: widget 404 missing" }));
    expect(msg).not.toContain("Not found: widget 404 missing");
    expect(msg).not.toMatch(/\b404\b/);
    expect(msg).toMatch(/couldn't find/i);
  });

  it("an explicit load kind + area gives the 5xx load wording (no 'changes' claim)", async () => {
    const msg = await errorMessageFromResponse(mockRes(500, {}), "load", "payroll run");
    expect(msg).toBe("We couldn't load the payroll run because of a problem on our side. Try again in a few minutes.");
  });

  it("an explicit offline kind wins over the status", async () => {
    const msg = await errorMessageFromResponse(mockRes(404, {}), "offline");
    expect(msg).toBe("We couldn't connect. Check your internet connection and try again.");
  });

  // The status-aware mapping is the default for every caller (no opt-in).
  it.each([
    [400, "Some details weren't accepted. Check what you entered and try again."],
    [422, "Some details weren't accepted. Check what you entered and try again."],
    [401, "Your session has ended. Sign in again to continue."],
    [403, "You don't have permission to do this. Ask your administrator if you need access."],
    [413, "The file is too large. Upload a file smaller than the allowed size."],
    [415, "This file type isn't accepted. Upload a supported file."],
    [429, "Too many attempts. Wait a minute, then try again."],
    [500, "We couldn't save the leave request because of a problem on our side. Your changes haven't been saved. Try again in a few minutes."],
    [502, "We couldn't save the leave request because of a problem on our side. Your changes haven't been saved. Try again in a few minutes."],
  ])("status %s resolves to the standard wording by default", async (status, expected) => {
    expect(await errorMessageFromResponse(mockRes(status, {}), undefined, "leave request")).toBe(expected);
  });

  it("a known domain code wins over the generic status copy", async () => {
    const msg = await errorMessageFromResponse(mockRes(409, { code: "SELF_APPROVAL_FORBIDDEN", message: "x" }));
    expect(msg).toBe("You can't approve your own request. Another approver needs to do this.");
    expect(msg).not.toContain("SELF_APPROVAL_FORBIDDEN");
  });

  it("errorMessageForStatus is an alias of the (now default) status-aware mapping", async () => {
    const res = mockRes(403, {});
    expect(await errorMessageForStatus(res)).toBe(await errorMessageFromResponse(res));
  });
});

describe("browserJson failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws a UserFacingError with standard copy and the support reference separate from the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockRes(500, { message: "pg: relation x missing" }, false, { "x-request-id": "req_77ab" })));
    let caught: unknown;
    try {
      await browserJson("v1/things");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UserFacingError);
    expect((caught as Error).message).not.toContain("req_77ab");
    expect((caught as Error).message).not.toContain("pg:");
    expect(referenceFromError(caught)).toBe("req_77ab");
  });
});

describe("browserFetch network failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("converts a raw 'Failed to fetch' TypeError into a UserFacingError with the network copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    let caught: unknown;
    try {
      await browserFetch("v1/things");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UserFacingError);
    expect((caught as Error).message).toBe("We couldn't connect. Check your internet connection and try again.");
    expect((caught as Error).message).not.toContain("Failed to fetch");
  });

  it("browserJson surfaces the same network copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("NetworkError when attempting to fetch resource."); }));
    await expect(browserJson("v1/things")).rejects.toThrow("We couldn't connect. Check your internet connection and try again.");
  });

  it("leaves a caller-initiated abort untouched so callers can still detect it", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }));
    await expect(browserFetch("v1/things")).rejects.toBe(abort);
  });
});

// GAP-PAYROLL-STATUTORY-PT-06: status-class messages (formerly opt-in; now the default for every caller).
describe("errorMessageForStatus", () => {
  it("maps a 403 to a permission message, never echoing backend text", async () => {
    const msg = await errorMessageForStatus(mockRes(403, { code: "FORBIDDEN", message: "requires one of: payroll_admin" }));
    expect(msg).toBe("You don't have permission to do this. Ask your administrator if you need access.");
    expect(msg).not.toContain("payroll_admin");
    expect(msg).not.toContain("FORBIDDEN");
  });

  it("maps 400 and 422 to a not-accepted message", async () => {
    for (const status of [400, 422]) {
      const msg = await errorMessageForStatus(mockRes(status, { code: "PT_SLAB_OVERLAP", message: "slab 0-1 overlaps" }));
      expect(msg).toBe("Some details weren't accepted. Check what you entered and try again.");
      expect(msg).not.toContain("PT_SLAB_OVERLAP");
      expect(msg).not.toContain("overlaps");
    }
  });

  it("everything else gets the status-specific entry, and an area makes it specific", async () => {
    expect(await errorMessageForStatus(mockRes(500, undefined, true), "professional tax slab")).toBe(
      "We couldn't save the professional tax slab because of a problem on our side. Your changes haven't been saved. Try again in a few minutes.",
    );
    expect(await errorMessageForStatus(mockRes(409, {}))).toBe(
      "This information was changed by someone else. Refresh to see the latest version, then try again.",
    );
    expect(await errorMessageForStatus(mockRes(404, {}))).toBe(
      "We couldn't find this information. It may have been removed or the link may be wrong.",
    );
  });

  it("the default errorMessageFromResponse is the same status-aware mapping", async () => {
    expect(await errorMessageFromResponse(mockRes(403, {}))).toBe(await errorMessageForStatus(mockRes(403, {})));
    expect(await errorMessageFromResponse(mockRes(400, {}))).toBe(await errorMessageForStatus(mockRes(400, {})));
  });
});
