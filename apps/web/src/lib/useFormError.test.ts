import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { UserFacingError } from "./userFacingError";
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

  it("maps a FORBIDDEN code to the distinct 'no permission' copy (SF-14), not a generic save failure", async () => {
    const { result } = renderHook(() => useFormError("designation"));
    const res = jsonResponse(403, { code: "FORBIDDEN", message: "forbidden" });

    await act(async () => {
      await result.current.fromResponse(res, "save");
    });

    expect(result.current.message).toMatch(/permission/i);
    expect(result.current.message).not.toMatch(/couldn't save/i);
    expect(result.current.message).not.toMatch(/\b403\b/);
  });

  it("a bare 403 with no JSON envelope still gets permission copy, never 'try again' (GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-05)", async () => {
    const { result } = renderHook(() => useFormError("advance"));
    const res = new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    await act(async () => {
      await result.current.fromResponse(res, "save");
    });
    expect(result.current.message).toMatch(/permission/i);
    expect(result.current.message).not.toMatch(/try again/i);
    expect(result.current.message).not.toMatch(/\b403\b/);
  });

  it("a 422 gets the standard validation copy", async () => {
    const { result } = renderHook(() => useFormError("advance"));
    await act(async () => {
      await result.current.fromResponse(jsonResponse(422, { code: "VALIDATION_FAILED" }), "save");
    });
    expect(result.current.message).toMatch(/Some details weren't accepted\. Check what you entered and try again\./);
  });

  it("fromException never reads err.message and never leaks a status code", () => {
    const { result } = renderHook(() => useFormError("grievance"));
    act(() => {
      result.current.fromException("save");
    });
    expect(result.current.message.length).toBeGreaterThan(0);
    expect(result.current.message).not.toMatch(/\d{3}/);
  });

  describe("status-aware standard copy (default, no opt-in)", () => {
    const msg = async (res: Response) => {
      const { result } = renderHook(() => useFormError("leave request"));
      await act(async () => {
        await result.current.fromResponse(res, "save");
      });
      return result.current.message;
    };

    it.each([
      [401, "Your session has ended. Sign in again to continue."],
      [404, "We couldn't find this leave request. It may have been removed or the link may be wrong."],
      [409, "This leave request was changed by someone else. Refresh to see the latest version, then try again."],
      [429, "Too many attempts. Wait a minute, then try again."],
      [500, "We couldn't save the leave request because of a problem on our side. Your changes haven't been saved. Try again in a few minutes."],
    ])("status %s", async (status, expected) => {
      expect(await msg(jsonResponse(status, { message: "raw backend text" }))).toBe(expected);
    });

    it("a known domain code wins over the generic status copy and is never echoed", async () => {
      const m = await msg(jsonResponse(409, { code: "SELF_APPROVAL_FORBIDDEN", message: "x" }));
      expect(m).toBe("You can't approve your own request. Another approver needs to do this.");
    });

    it("keeps backend fieldErrors and exposes a de-emphasised support reference from the response header", async () => {
      const { result } = renderHook(() => useFormError("leave request"));
      const res = new Response(JSON.stringify({ code: "VALIDATION_FAILED", fieldErrors: [{ field: "from", message: "Choose a start date" }] }), {
        status: 422,
        headers: { "content-type": "application/json", "x-correlation-id": "corr-4f9a21" },
      });
      await act(async () => {
        await result.current.fromResponse(res, "save");
      });
      expect(result.current.fieldError("from")).toBe("Choose a start date");
      expect(result.current.reference).toBe("corr-4f9a21");
      expect(result.current.message).not.toContain("corr-4f9a21");
    });
  });

  describe("fromException(kind, err)", () => {
    it("a failed fetch (TypeError) reads as a connection problem", () => {
      const { result } = renderHook(() => useFormError("leave request"));
      act(() => {
        result.current.fromException("save", new TypeError("Failed to fetch"));
      });
      expect(result.current.message).toBe("We couldn't connect. Check your internet connection and try again.");
    });

    it("a UserFacingError (a failed response thrown by browserJson) keeps its status-aware message and reference", () => {
      const { result } = renderHook(() => useFormError("leave request"));
      act(() => {
        result.current.fromException("save", new UserFacingError("You don't have permission to do this. Ask your administrator if you need access.", "req_1a2b"));
      });
      expect(result.current.message).toBe("You don't have permission to do this. Ask your administrator if you need access.");
      expect(result.current.reference).toBe("req_1a2b");
    });

    it("a response resolved, rethrown as UserFacingError.from and caught keeps its 403 copy (not 'check your internet')", async () => {
      const { result } = renderHook(() => useFormError("leave request"));
      let resolved!: Awaited<ReturnType<typeof result.current.fromResponse>>;
      await act(async () => {
        resolved = await result.current.fromResponse(jsonResponse(403, { message: "nope" }), "save");
      });
      act(() => {
        try {
          throw UserFacingError.from(resolved);
        } catch (caught) {
          result.current.fromException("save", caught);
        }
      });
      expect(result.current.message).toBe("You don't have permission to do this. Ask your administrator if you need access.");
      expect(result.current.message).not.toMatch(/internet/i);
    });

    it("an unclassified error is honest about not knowing the cause, and never echoes err.message", () => {
      const { result } = renderHook(() => useFormError("leave request"));
      act(() => {
        result.current.fromException("save", new Error("pg: connection refused 10.0.0.4"));
      });
      expect(result.current.message).toBe(
        "We couldn't save the leave request. Your changes haven't been saved. Check your internet connection and try again in a few minutes.",
      );
      expect(result.current.message).not.toContain("pg:");
    });

    it("a load exception does not claim changes were lost", () => {
      const { result } = renderHook(() => useFormError("payslips"));
      act(() => {
        result.current.fromException("load");
      });
      expect(result.current.message).toBe("We couldn't load the payslips. Check your internet connection and try again in a few minutes.");
    });
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
