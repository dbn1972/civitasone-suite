import { describe, it, expect } from "vitest";
import { userFacingErrorFromResponse } from "./userFacingFromResponse";
import { UserFacingError, referenceFromError } from "../userFacingError";

function res(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? "raw backend text <html>" : JSON.stringify(body), { status, headers });
}

describe("userFacingErrorFromResponse", () => {
  it("never carries the raw response body (the old `new Error(await res.text())` shape)", async () => {
    const err = await userFacingErrorFromResponse(res(500, undefined), "save", "work order");
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.message).toBe(
      "We couldn't save the work order because of a problem on our side. Your changes haven't been saved. Try again in a few minutes.",
    );
    expect(err.message).not.toContain("raw backend text");
  });

  it("is status-aware, keeps a domain code's specific copy, and exposes the support reference separately", async () => {
    const err = await userFacingErrorFromResponse(
      res(403, { code: "SELF_APPROVAL", message: "Cannot approve your own request" }, { "x-request-id": "req_5e1f" }),
      "save",
    );
    expect(err.message).toBe("You can't approve your own request. Another approver needs to do this.");
    expect(referenceFromError(err)).toBe("req_5e1f");
    expect(err.message).not.toContain("req_5e1f");
  });

  it("a load kind drops the 'changes' sentence", async () => {
    const err = await userFacingErrorFromResponse(res(502), "load", "request");
    expect(err.message).toBe("We couldn't load the request because of a problem on our side. Try again in a few minutes.");
  });
});

describe("UserFacingError.from", () => {
  it("keeps the message and the reference of an already-resolved state across a rethrow", () => {
    const e = UserFacingError.from({ message: "We couldn't connect.", reference: "abc-123" });
    expect(e.message).toBe("We couldn't connect.");
    expect(e.reference).toBe("abc-123");
    expect(UserFacingError.from({ message: "x" }).reference).toBeNull();
  });
});
