import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewProposalPage from "./page";

function fillValid() {
  fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Repair of the approach road." } });
  fireEvent.change(screen.getByLabelText(/Estimated cost/i), { target: { value: "500000.10" } });
}

describe("NewProposalPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when creating fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    render(<NewProposalPage />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});

describe("NewProposalPage — GAP-WORKS-PROPOSALS-NEW-02 (money, bigint paise)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("echoes the exact formatted amount under the cost field", () => {
    render(<NewProposalPage />);
    fireEvent.change(screen.getByLabelText(/Estimated cost/i), { target: { value: "500000.10" } });
    expect(screen.getByText("= ₹5,00,000.10")).toBeInTheDocument();
  });

  it("rejects a zero cost before any POST", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewProposalPage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/Estimated cost/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    expect(await screen.findByText(/more than ₹0/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends an exact paise value for a valid cost", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p9" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    render(<NewProposalPage />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.estimatedCostMinor).toBe("50000010");
  });
});

describe("NewProposalPage — GAP-WORKS-PROPOSALS-NEW-03 (honest draft copy)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("uses draft-oriented copy, not 'submit for approval'", () => {
    render(<NewProposalPage />);
    expect(screen.getByText(/Create a draft work proposal/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create draft/i })).toBeInTheDocument();
    expect(screen.queryByText(/for approval/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Submit$/ })).not.toBeInTheDocument();
  });

  it("redirects to the created proposal's detail page when an id is returned", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p9" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    render(<NewProposalPage />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/works/proposals/p9"), { timeout: 2000 });
  });
});

describe("NewProposalPage — GAP-WORKS-PROPOSALS-NEW-05 (cancel)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("offers a Cancel button that returns to the list when the form is pristine", () => {
    render(<NewProposalPage />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(pushMock).toHaveBeenCalledWith("/works/proposals");
  });

  it("confirms before discarding a dirty form", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NewProposalPage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "typed something" } });
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("NewProposalPage — GAP-WORKS-PROPOSALS-NEW-01 (work type picker)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("renders a searchable combobox for work type, not a raw UUID textbox", () => {
    render(<NewProposalPage />);
    const picker = screen.getByRole("combobox", { name: /work type/i });
    expect(picker).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/UUID from masters/i)).not.toBeInTheDocument();
  });
});
