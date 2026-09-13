import { describe, it, expect } from "vitest";
import { errorMessageFromResponse } from "./browserClient";

function mockRes(status: number, body?: unknown, throwOnJson = false): Response {
  return {
    status,
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
    expect(msg).toMatch(/couldn't save/i);
  });

  it("never echoes a bare message with no code either", async () => {
    const msg = await errorMessageFromResponse(mockRes(400, { message: "IFSC must be exactly 11 characters." }));
    expect(msg).not.toContain("IFSC must be exactly 11 characters.");
    expect(msg).toMatch(/couldn't save/i);
  });

  it("never echoes a nested error.{code,message} envelope", async () => {
    const msg = await errorMessageFromResponse(
      mockRes(503, { error: { code: "INTEGRATION_DISABLED", message: "PFMS is offline" } }),
    );
    expect(msg).not.toContain("INTEGRATION_DISABLED");
    expect(msg).not.toContain("PFMS is offline");
    expect(msg).toMatch(/couldn't save/i);
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

  it("does not read the response body at all — nothing in it can leak", async () => {
    // A body that would throw if `.json()` were ever awaited on it for real;
    // mockRes's `clone()` returns `this`, so a stray body-read would surface
    // here too.
    const res = mockRes(400, { code: "SHOULD_NEVER_APPEAR", message: "should never appear either" });
    const msg = await errorMessageFromResponse(res);
    expect(msg).not.toContain("SHOULD_NEVER_APPEAR");
    expect(msg).not.toContain("should never appear either");
  });

  it('maps a 404 to the "load" catalogue entry ("couldn\'t load"), not "save"', async () => {
    const msg = await errorMessageFromResponse(mockRes(404, {}));
    expect(msg).toMatch(/couldn't load/i);
  });

  it("still resolves the status internally only to pick a catalogue entry, never to display it", async () => {
    const msg = await errorMessageFromResponse(mockRes(404, { message: "Not found: widget 404 missing" }));
    // The body's own message text happens to contain "404" — proves the
    // guard isn't just stripping the literal status digits post hoc, it
    // never reads the message into the output at all.
    expect(msg).not.toContain("Not found: widget 404 missing");
    expect(msg).toMatch(/couldn't load/i);
  });

  it("accepts an explicit kind + area, matching useFormError.fromResponse's own parameters", async () => {
    const msg = await errorMessageFromResponse(mockRes(500, {}), "load", "payroll run");
    expect(msg).toMatch(/couldn't load this payroll run/i);
  });

  it("a 404 with an explicit kind still prefers the caller's kind over the status-based default", async () => {
    const msg = await errorMessageFromResponse(mockRes(404, {}), "offline");
    expect(msg).toMatch(/offline/i);
  });
});
