/**
 * UAT T-EDGE bundle 21 -- web side.
 *
 * TE-10: a form submitted after the session expired. The middleware answers the API call with a
 * JSON 401 SESSION_EXPIRED (it used to 307 to the sign-in page, which a POST then turned into a
 * 405 and the form said "a problem on our side"). The form message now says the session expired
 * and the entries are kept; the shell shows a "Sign in again" notice that opens sign-in in a new
 * tab returning to this page, so the typed values in this tab stay.
 * Field codes (DATE_INVALID, AADHAAR_INVALID ...) read as en/hi copy; TASK_ALREADY_DECIDED names
 * the officer who decided first (TE-08).
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, render, screen, cleanup } from "@testing-library/react";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { useFormError } from "./lib/useFormError";
import { decisionFailure } from "./lib/decisionError";
import { fieldCodeMessage, taskAlreadyDecidedMessage, FIELD_CODE_COPY, SESSION_EXPIRED_EVENT } from "./lib/validationCopy";
import { DOMAIN_CODE_MESSAGES } from "./lib/errorCatalogue";
import { SessionExpiredNotice } from "./app/_components/session/SessionExpiredNotice";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => cleanup());

describe("session expired mid-form (TE-10)", () => {
  it("the middleware answers an anonymous API POST with a JSON 401 SESSION_EXPIRED, not a redirect", async () => {
    const res = await middleware(new NextRequest(new URL("https://demo.test/api/proxy/v1/hrms/leave-requests"), { method: "POST" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    expect((await res.json()).code).toBe("SESSION_EXPIRED");
  });

  it("a page (not an API call) still goes to the sign-in page with a return URL", async () => {
    const res = await middleware(new NextRequest(new URL("https://demo.test/hr/leave/apply")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
    expect(res.headers.get("location")).toContain("next=%2Fhr%2Fleave%2Fapply");
  });

  it("the form says the session expired and the entries are kept, and signals the shell", async () => {
    let signalled = 0;
    const onExpired = () => { signalled += 1; };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    const { result } = renderHook(() => useFormError("leave request"));
    await act(async () => {
      await result.current.fromResponse(json(401, { code: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." }), "save");
    });
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    expect(result.current.message).toBe("Your session has expired. Sign in again — your entries on this page are kept.");
    expect(result.current.message).not.toMatch(/problem on our side|try again in a few minutes/i);
    expect(signalled).toBe(1);
  });

  it("the shell notice offers Sign in again, in a new tab, returning to this page", async () => {
    window.history.replaceState(null, "", "/hr/leave/apply?x=1");
    render(<SessionExpiredNotice />);
    expect(screen.queryByTestId("session-expired-notice")).toBeNull();
    await act(async () => { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT)); });
    const notice = screen.getByTestId("session-expired-notice");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("Your session has expired.");
    expect(notice.textContent).toContain("your entries on this page are kept");
    const link = screen.getByRole("link", { name: /sign in again/i });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toBe(`/auth/login?error=session_expired&next=${encodeURIComponent("/hr/leave/apply?x=1")}`);
  });

  it("has Hindi copy", () => {
    expect(DOMAIN_CODE_MESSAGES.SESSION_EXPIRED!.hi.what).toBe("आपका सत्र समाप्त हो गया है।");
    expect(DOMAIN_CODE_MESSAGES.SESSION_EXPIRED!.actions).toEqual(["signin"]);
  });
});

describe("field-level codes read as en/hi copy (TE-12)", () => {
  it("maps a known field code and keeps the backend text for an unknown one", async () => {
    const { result } = renderHook(() => useFormError("employee"));
    await act(async () => {
      await result.current.fromResponse(json(400, {
        code: "VALIDATION_FAILED", message: "invalid request",
        fieldErrors: [
          { field: "dateOfJoining", message: "date of joining must be a real calendar date written YYYY-MM-DD", code: "DATE_INVALID" },
          { field: "aadhaarRef", message: "raw", code: "AADHAAR_INVALID" },
          { field: "email", message: "Invalid email" },
        ],
      }));
    });
    expect(result.current.fieldError("dateOfJoining")).toBe("Enter a real calendar date.");
    expect(result.current.fieldError("aadhaarRef")).toBe("Enter the full 12-digit Aadhaar number. Only the last 4 digits are kept.");
    expect(result.current.fieldError("email")).toBe("Invalid email");
  });

  it("every field code has en and hi copy", () => {
    for (const [code, copy] of Object.entries(FIELD_CODE_COPY)) {
      expect(copy.en.length, code).toBeGreaterThan(5);
      expect(copy.hi.length, code).toBeGreaterThan(5);
      expect(copy.hi, code).not.toBe(copy.en);
    }
    expect(fieldCodeMessage("GSTIN_INVALID", "hi")).toContain("GSTIN");
    expect(fieldCodeMessage("NO_SUCH_CODE")).toBeUndefined();
  });

  it("every new top-level code has en and hi copy", () => {
    for (const code of ["TASK_ALREADY_DECIDED", "IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_IN_PROGRESS", "INDENT_NOT_FOUND", "INDENT_NOT_APPROVED", "INDENT_BUDGET_EXCEEDED", "PO_LINE_NOT_FOUND", "HEAD_NOT_FOUND", "ALLOCATION_BELOW_COMMITTED", "UNKNOWN_ACCOUNT_CODE", "LEAVE_OUTSIDE_ALLOCATION_PERIOD"]) {
      const m = DOMAIN_CODE_MESSAGES[code];
      expect(m, code).toBeDefined();
      expect(m!.en.what && m!.hi.what && m!.en.next && m!.hi.next, code).toBeTruthy();
    }
  });
});

describe("the losing checker hears who decided (TE-08)", () => {
  it("names the decider in en and hi, or falls back to the catalogue copy", () => {
    expect(taskAlreadyDecidedMessage({ id: "u", name: "Asha Rao" }, "en")).toBe("Asha Rao has already decided this. Your decision was not recorded. Refresh to see the latest status.");
    expect(taskAlreadyDecidedMessage({ id: "u", name: "Asha Rao" }, "hi")).toContain("Asha Rao इस पर पहले ही निर्णय ले चुके हैं");
    expect(taskAlreadyDecidedMessage({ id: "u", name: null }, "en")).toBeNull();
  });

  it("useFormError and decisionFailure use it for a 409 TASK_ALREADY_DECIDED", async () => {
    const body = { code: "TASK_ALREADY_DECIDED", message: "x", decidedBy: { id: "u2", name: "Asha Rao" } };
    const { result } = renderHook(() => useFormError("journal"));
    await act(async () => { await result.current.fromResponse(json(409, body), "save"); });
    expect(result.current.message).toContain("Asha Rao has already decided this.");
    const d = await decisionFailure(json(409, body), "journal");
    expect(d).toEqual({ message: "Asha Rao has already decided this. Your decision was not recorded. Refresh to see the latest status.", stale: true });
    const plain = await decisionFailure(json(409, { code: "TASK_ALREADY_DECIDED" }), "journal");
    expect(plain.stale).toBe(true);
  });
});
