import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fb from "./feedback";

function res(body: unknown, init: { status?: number } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("submitCitizenFeedback (GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05)", () => {
  it("POSTs the rating, comment, submission type and optional service request", async () => {
    fetchMock.mockResolvedValueOnce(res({ id: "f1", status: "accepted" }, { status: 202 }));
    await fb.submitCitizenFeedback({
      rating: 4,
      comment: "  Great  ",
      serviceRequestId: "44444444-dddd-4000-8000-00000000f001",
      submissionType: "registered",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("v1/crm/citizen-feedback");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      rating: 4,
      comment: "Great",
      serviceRequestId: "44444444-dddd-4000-8000-00000000f001",
      submissionType: "registered",
    });
  });

  it("omits an empty comment and an absent service request", async () => {
    fetchMock.mockResolvedValueOnce(res({ id: "f2", status: "accepted" }, { status: 202 }));
    await fb.submitCitizenFeedback({ rating: 5, comment: "   " });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ rating: 5, submissionType: "anonymous" });
  });

  it("throws a human message on a failed submit", async () => {
    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "no" }, { status: 400 }));
    await expect(fb.submitCitizenFeedback({ rating: 3 })).rejects.toThrow();
  });
});
