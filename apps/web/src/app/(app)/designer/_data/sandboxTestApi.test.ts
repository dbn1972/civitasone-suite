import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSandboxTest } from "./sandboxTestApi";

/**
 * UX-016: sandboxTestApi.ts's runSandboxTest used to throw the raw response
 * body text (falling back to `Sandbox test failed (${status})`) on a
 * failed run — the same class of leak useFormError closes for components
 * (UX-003). This module is a plain async data client, not a component, so
 * it can't use that hook; it now goes through the same catalogued
 * toHumanError vocabulary instead and never reads the response body at
 * all, so it structurally cannot leak it.
 */
describe("sandboxTestApi — runSandboxTest never leaks raw status or server text", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("throws a clerk-safe message, never the raw HTTP status or server text, when the run fails", async () => {
    fetchMock.mockResolvedValue(new Response("sandbox-runner circuit open", { status: 502 }));
    const err = await runSandboxTest("def-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b502\b/);
    expect(message).not.toContain("sandbox-runner circuit open");
    expect(message).toMatch(/couldn't save/i);
  });
});
