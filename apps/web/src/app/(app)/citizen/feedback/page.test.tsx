import { describe, it, expect, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error("NEXT_REDIRECT:" + url);
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));

import CitizenFeedbackPage from "./page";

describe("CitizenFeedbackPage (D3 CITIZEN-FEEDBACK-03)", () => {
  it("redirects to the existing citizen surveys module", () => {
    expect(() => CitizenFeedbackPage()).toThrow("NEXT_REDIRECT:/citizen/surveys");
    expect(redirect).toHaveBeenCalledWith("/citizen/surveys");
  });
});
