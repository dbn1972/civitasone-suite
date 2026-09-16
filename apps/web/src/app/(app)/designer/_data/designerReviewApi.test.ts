import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publishDefinition, rejectDefinition, submitForApproval } from "./designerReviewApi";

/**
 * UX-016: designerReviewApi.ts's parseAccepted used to throw the raw
 * response body text (falling back to `Request failed (${status}).`) on a
 * failed submit/publish/reject call — the same class of leak useFormError
 * closes for components (UX-003). This module is a plain async data
 * client, not a component, so it can't use that hook; it now goes through
 * the same catalogued toHumanError vocabulary instead and never reads the
 * response body at all, so it structurally cannot leak it.
 */
describe("designerReviewApi — never leaks raw status or server text on failure", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submitForApproval throws a clerk-safe message, never the raw HTTP status or server text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "workflow-service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const err = await submitForApproval("def-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b503\b/);
    expect(message).not.toContain("workflow-service unavailable");
    expect(message).toMatch(/couldn't save/i);
  });

  it("publishDefinition throws the same clerk-safe message on failure", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await publishDefinition("def-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });

  it("rejectDefinition throws the same clerk-safe message on failure", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await rejectDefinition("def-1", "Missing statutory reference").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });
});
