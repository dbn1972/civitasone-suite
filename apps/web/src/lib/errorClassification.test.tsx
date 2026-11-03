import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { ERROR_CATALOGUE, resolveHumanError, statusToKind } from "./errorCatalogue";
import { isPresentableMessage, loadFailureKind, messageForThrown } from "./messages";
import { UserFacingError, classifyThrown, isNetworkFailure, isTimeoutFailure } from "./userFacingError";
import { LoadErrorState } from "@/app/_components/ds/LoadErrorState";

/**
 * GAP-UAT-P3-ERRCOPY: the error state must name the right cause. "Check your internet
 * connection" is only for a genuine browser-side network failure -- never for a
 * server-side loader that got no answer (the journal-approvals screen said "We couldn't
 * connect. Check your internet connection" while the browser was online).
 */
const INTERNET = /internet|इंटरनेट/i;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadFailureKind: which situation a loader failure with no status is in", () => {
  it("defers to the HTTP status when there is one", () => {
    expect(loadFailureKind(500, { onServer: true, offline: false })).toBeUndefined();
    expect(loadFailureKind(403, { onServer: false, offline: false })).toBeUndefined();
  });
  it("a server-side loader with no answer is a problem on our side", () => {
    expect(loadFailureKind(undefined, { onServer: true, offline: false })).toBe("server");
    expect(loadFailureKind(0, { onServer: true, offline: false })).toBe("server");
  });
  it("in an online browser the cause is unknown, never the connection", () => {
    expect(loadFailureKind(undefined, { onServer: false, offline: false })).toBe("unknown");
  });
  it("only an offline browser is a network failure", () => {
    expect(loadFailureKind(undefined, { onServer: false, offline: true })).toBe("network");
  });
});

describe("statusToKind: timeouts are not connection failures", () => {
  it("408 and 504 read as the server taking too long", () => {
    expect(statusToKind(408)).toBe("timeout");
    expect(statusToKind(504)).toBe("timeout");
    expect(statusToKind(502)).toBe("server");
    expect(statusToKind(503)).toBe("server");
  });
});

describe("copy: only the network kind may mention the internet connection", () => {
  for (const locale of ["en", "hi"] as const) {
    for (const [kind, entry] of Object.entries(ERROR_CATALOGUE[locale].kinds)) {
      if (kind === "network") continue;
      it(locale + ": " + kind + " never blames the connection", () => {
        expect(entry.what + " " + entry.next + " " + (entry.nextRead ?? "")).not.toMatch(INTERNET);
      });
    }
  }
  it("a server failure on load names the object and the next step", () => {
    const r = resolveHumanError({ status: 500, ctx: { locale: "en", intent: "load", area: "pending journals" } });
    expect(r.what + " " + r.next).toBe("We couldn't load the pending journals because of a problem on our side. Try again in a few minutes.");
  });
  it("hi: the timeout copy is Hindi and keeps the object", () => {
    const r = resolveHumanError({ status: 504, ctx: { locale: "hi", intent: "load", area: "जर्नल" } });
    expect(r.what).toBe("हम जर्नल को समय पर लोड नहीं कर सके।");
  });
});

describe("LoadErrorState: the journal-approvals case", () => {
  it("no status in an online browser: names the object, does not say check your internet", () => {
    render(createElement(LoadErrorState, { result: { status: undefined }, area: "pending journals" }));
    expect(screen.getByText(/We couldn.t load the pending journals\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(INTERNET);
    expect(screen.queryByText("We couldn't connect.")).not.toBeInTheDocument();
  });
  it("no status while the browser is offline: the connection copy", () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    render(createElement(LoadErrorState, { result: { status: undefined }, area: "pending journals" }));
    expect(screen.getByText("We couldn't connect.")).toBeInTheDocument();
  });
  it("a 502 from the gateway: a problem on our side", () => {
    render(createElement(LoadErrorState, { result: { status: 502 }, area: "pending journals" }));
    expect(screen.getByText(/because of a problem on our side/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(INTERNET);
  });
});

describe("thrown values: network only for a real fetch failure", () => {
  it("TypeError from fetch is a network failure; a TypeError from a bug is not", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined (reading x)"))).toBe(false);
    expect(classifyThrown(new TypeError("x.map is not a function"))).toBe("unknown");
  });
  it("aborts and timeouts are timeouts, not network failures", () => {
    const t = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    expect(isNetworkFailure(t)).toBe(false);
    expect(isTimeoutFailure(t)).toBe(true);
  });
});

describe("messageForThrown: raw text is replaced by mapped copy", () => {
  it("keeps a UserFacingError and its reference", () => {
    const r = messageForThrown(new UserFacingError("We couldn't save the bill. Try again.", "7F3A9C"));
    expect(r).toEqual({ message: "We couldn't save the bill. Try again.", reference: "7F3A9C" });
  });
  it("maps a bare snake_case reason (the install-steps case)", () => {
    const r = messageForThrown(new Error("no_drafts_imported"));
    expect(r.message).toContain("didn't add any draft forms");
    expect(r.message).not.toContain("no_drafts_imported");
  });
  it("maps a bare service code", () => {
    expect(messageForThrown(new Error("BUDGET_EXCEEDED")).message).toContain("more than the budget");
    expect(messageForThrown("Error: TASK_NOT_AUTHORIZED").message).toContain("isn't assigned to you");
  });
  it("never shows stack text or a raw body", () => {
    for (const raw of ["TypeError: Cannot read properties of undefined", "{\"code\":\"X\",\"message\":\"boom\"}", "Request failed (500)", "<html>502 Bad Gateway</html>"]) {
      const m = messageForThrown(new Error(raw)).message;
      expect(m, raw).not.toContain(raw);
      expect(m).not.toMatch(INTERNET);
    }
  });
  it("keeps a plain-language message a caller threw on purpose", () => {
    expect(messageForThrown(new Error("Enter a reason of at least 10 characters.")).message).toBe("Enter a reason of at least 10 characters.");
  });
  it("isPresentableMessage rejects codes, statuses and keys", () => {
    expect(isPresentableMessage("Request failed (500)")).toBe(false);
    expect(isPresentableMessage("approval failed: MAKER_CHECKER_VIOLATION")).toBe(false);
    expect(isPresentableMessage("leave_type_not_found for this user")).toBe(false);
    expect(isPresentableMessage("Choose a date in an open period.")).toBe(true);
  });
});
