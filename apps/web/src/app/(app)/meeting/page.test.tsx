import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getMeetingsMock = vi.fn();
vi.mock("./_data/loaders", () => ({
  getMeetings: (...args: unknown[]) => getMeetingsMock(...args),
}));

import MeetingHomePage from "./page";

const OK_ALL = { data: [], source: "api" as const };
const OK_IN_PROGRESS = { data: [], source: "api" as const };

describe("MeetingHomePage — error badge accounts for both queries (fix 10)", () => {
  beforeEach(() => {
    getMeetingsMock.mockReset();
  });

  it("shows no error badge when both queries succeed", async () => {
    getMeetingsMock.mockImplementation((status?: string) =>
      Promise.resolve(status === "in_progress" ? OK_IN_PROGRESS : OK_ALL),
    );
    render(await MeetingHomePage());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the error badge when the 'all meetings' query fails", async () => {
    getMeetingsMock.mockImplementation((status?: string) =>
      Promise.resolve(status === "in_progress" ? OK_IN_PROGRESS : { data: [], source: "error" }),
    );
    render(await MeetingHomePage());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the error badge when only the 'in progress' query fails (the bug this fixes)", async () => {
    getMeetingsMock.mockImplementation((status?: string) =>
      Promise.resolve(status === "in_progress" ? { data: [], source: "error" } : OK_ALL),
    );
    render(await MeetingHomePage());
    // Before the fix, an in-progress-only failure showed a silent "0" with
    // no error indication at all — the badge is the observable proof it's
    // now accounted for.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
