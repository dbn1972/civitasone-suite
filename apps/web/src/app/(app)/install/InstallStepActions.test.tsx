import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InstallStepActions } from "./InstallStepActions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("InstallStepActions (GAP-INSTALL-HOME-04/05)", () => {
  // HOME-04: the available buttons are derived from status.
  it("pending offers Run and Skip but not Retry", () => {
    render(<InstallStepActions id="s1" status="pending" title="Seed" isRequired={false} />);
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("failed offers Retry and Skip but not Run", () => {
    render(<InstallStepActions id="s1" status="failed" title="Seed" isRequired={false} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run" })).not.toBeInTheDocument();
  });

  it("in_progress offers no action buttons", () => {
    render(<InstallStepActions id="s1" status="in_progress" title="Seed" isRequired={false} />);
    expect(screen.queryByRole("button", { name: "Run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/running/i);
  });

  // HOME-03: skipping an OPTIONAL step now opens a confirmation dialog too.
  it("skipping an optional step opens a confirm dialog", async () => {
    render(<InstallStepActions id="s1" status="pending" title="Optional thing" isRequired={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // HOME-05: a 500 with a JSON body surfaces a human sentence, not raw JSON.
  it("shows a clerk-safe error on failure, not the raw response body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "INTERNAL", message: "stacktrace leak" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<InstallStepActions id="s1" status="pending" title="Seed" isRequired={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/stacktrace leak/);
    expect(alert.textContent).toMatch(/\w/);
  });

  // HOME-05: the Run button shows a busy label while the request is in flight.
  it("shows a 'Running…' busy label during the request", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolveFetch = r)));
    render(<InstallStepActions id="s1" status="pending" title="Seed" isRequired={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Running/i })).toBeInTheDocument());
    resolveFetch(new Response("{}", { status: 202 }));
  });
});
