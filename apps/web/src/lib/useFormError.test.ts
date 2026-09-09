import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormError } from "./useFormError";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("useFormError", () => {
  it("maps a fieldErrors envelope to inline field-level messages, not a raw error string", async () => {
    const { result } = renderHook(() => useFormError("indent"));
    const res = jsonResponse(422, {
      code: "VALIDATION_FAILED",
      message: "validation_failed",
      fieldErrors: [
        { field: "purpose", message: "Purpose must be at least 3 characters." },
        { field: "department", message: "Department is required." },
      ],
    });

    await act(async () => {
      await result.current.fromResponse(res);
    });

    expect(result.current.fieldError("purpose")).toBe("Purpose must be at least 3 characters.");
    expect(result.current.fieldError("department")).toBe("Department is required.");
    // The summary line is catalogued toHumanError copy, not the raw envelope message.
    expect(result.current.message).not.toContain("validation_failed");
    expect(result.current.message.length).toBeGreaterThan(0);
  });

  it("never surfaces a raw HTTP status code or raw server error text", async () => {
    const { result } = renderHook(() => useFormError("indent"));
    const res = new Response("Internal Server Error\n  at Object.<anonymous> (/srv/index.js:42:9)", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

    await act(async () => {
      await result.current.fromResponse(res);
    });

    expect(result.current.message).not.toMatch(/\b500\b/);
    expect(result.current.message).not.toContain("Internal Server Error");
    expect(result.current.message).not.toContain("at Object.<anonymous>");
    expect(Object.keys(result.current.fieldErrors)).toHaveLength(0);
  });

  it("does not surface the response's raw `message` when there is no catalogued code", async () => {
    const { result } = renderHook(() => useFormError("payroll run"));
    const res = jsonResponse(409, { code: "CIRCUIT_OPEN", message: "upstream payroll-svc circuit open" });

    await act(async () => {
      await result.current.fromResponse(res, "save");
    });

    expect(result.current.message).not.toContain("upstream payroll-svc circuit open");
    expect(result.current.message).not.toContain("CIRCUIT_OPEN");
  });

  it("fromException never reads err.message and never leaks a status code", () => {
    const { result } = renderHook(() => useFormError("grievance"));
    act(() => {
      result.current.fromException("save");
    });
    expect(result.current.message.length).toBeGreaterThan(0);
    expect(result.current.message).not.toMatch(/\d{3}/);
  });

  it("clear() resets to the empty state", async () => {
    const { result } = renderHook(() => useFormError("indent"));
    await act(async () => {
      await result.current.fromResponse(jsonResponse(400, { fieldErrors: [{ field: "x", message: "bad" }] }));
    });
    expect(result.current.message).not.toBe("");
    act(() => result.current.clear());
    expect(result.current.message).toBe("");
    expect(Object.keys(result.current.fieldErrors)).toHaveLength(0);
  });
});
