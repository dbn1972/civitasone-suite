import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { EnrolButton } from "./EnrolButton";

describe("EnrolButton (GAP-LEARNING-COURSES-DETAIL-01/05)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("disables enrol and names unmet prerequisites instead of posting", () => {
    render(<EnrolButton courseId="c1" employeeId="e1" unmetPrereqs={["Safety 101", "Fire Drill"]} />);
    const btn = screen.getByRole("button", { name: /enrol now/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Safety 101, Fire Drill/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts JSON (not a form) to the proxy and refreshes on success", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "en1" }) });
    render(<EnrolButton courseId="c1" employeeId="e1" unmetPrereqs={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /enrol now/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/hrms/learning/courses/c1/enroll");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ employeeId: "e1" });
  });

  it("surfaces a 409 PREREQUISITES_NOT_MET message with missing names", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 409,
      json: async () => ({ code: "PREREQUISITES_NOT_MET", missing: ["Intro Course"] }),
    });
    render(<EnrolButton courseId="c1" employeeId="e1" unmetPrereqs={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /enrol now/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Prerequisites not met.*Intro Course/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
