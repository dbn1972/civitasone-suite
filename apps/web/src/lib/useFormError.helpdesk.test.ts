import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormError } from "./useFormError";

describe("useFormError 403 handling (GAP-HELPDESK-INTERNAL-NEW-05)", () => {
  it("maps a 403 response to the forbidden message, not generic save", async () => {
    const { result } = renderHook(() => useFormError("ticket"));
    let state: Awaited<ReturnType<typeof result.current.fromResponse>> | undefined;
    await act(async () => {
      const res = new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403, headers: { "content-type": "application/json" } });
      state = await result.current.fromResponse(res, "save");
    });
    expect(state).toBeDefined();
    expect(state!.message).toMatch(/permission/i);
    expect(state!.message).not.toMatch(/couldn't save/i);
  });

  it("still maps a 400 to the normal save message", async () => {
    const { result } = renderHook(() => useFormError("ticket"));
    let state: Awaited<ReturnType<typeof result.current.fromResponse>> | undefined;
    await act(async () => {
      const res = new Response(JSON.stringify({ code: "VALIDATION_FAILED" }), { status: 400, headers: { "content-type": "application/json" } });
      state = await result.current.fromResponse(res, "save");
    });
    expect(state).toBeDefined();
    expect(state!.message).not.toMatch(/permission/i);
  });
});
