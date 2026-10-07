import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const routerRefresh = vi.fn();
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: routerPush }),
}));

import { AttemptClient } from "./AttemptClient";

const QUESTIONS = [
  { id: "q1", qtype: "single", stem: "2+2?", options: [{ id: "a", text: "3" }, { id: "b", text: "4" }] },
];

beforeEach(() => {
  routerRefresh.mockReset();
  routerPush.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AttemptClient — GAP-LEARNING-ASSESSMENTS-01", () => {
  it("starts an attempt, lets the learner answer and submit, then shows the score/pass", async () => {
    const fetchMock = vi.fn()
      // start attempt
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "attempt-1", attemptNo: 1, status: "in_progress" }) })
      // submit
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "attempt-1", status: "graded", score: 10, passed: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<AttemptClient assessmentId="a1" employeeId="emp-1" questions={QUESTIONS} />);

    fireEvent.click(screen.getByRole("button", { name: /start attempt/i }));
    await screen.findByText("2+2?");
    // choose an answer
    fireEvent.click(screen.getByLabelText("4"));
    fireEvent.click(screen.getByRole("button", { name: /submit attempt/i }));

    await waitFor(() => expect(screen.getByText(/Passed/)).toBeInTheDocument());
    expect(screen.getByText("10")).toBeInTheDocument();

    // start POST then submit POST
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/proxy/v1/hrms/assessments/a1/attempts", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/proxy/v1/hrms/attempts/attempt-1/submit", expect.objectContaining({ method: "POST" }));
  });

  it("shows a human error (not a raw code) when the attempt limit is exhausted (409)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers(),
      text: async () => JSON.stringify({ code: "ATTEMPT_LIMIT", message: "maximum attempts exhausted" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AttemptClient assessmentId="a1" employeeId="emp-1" questions={QUESTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: /start attempt/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // raw code must not be shown verbatim
    expect(screen.queryByText(/ATTEMPT_LIMIT/)).not.toBeInTheDocument();
  });
});
