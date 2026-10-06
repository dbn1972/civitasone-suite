import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { CreateSchemeForm } from "./CreateSchemeForm";

describe("CreateSchemeForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  function fillForm(overrides?: { code?: string; budget?: string; max?: string }) {
    fireEvent.change(screen.getByLabelText(/scheme name/i), { target: { value: "PM Kisan Samman Nidhi" } });
    fireEvent.change(screen.getByLabelText(/scheme code/i), { target: { value: overrides?.code ?? "PM-KISAN-2024" } });
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: overrides?.budget ?? "500000" } });
    fireEvent.change(screen.getByLabelText(/maximum grant per application/i), {
      target: { value: overrides?.max ?? "100000" },
    });
  }

  it("submits the scheme to the correct proxied endpoint and navigates on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));

    render(<CreateSchemeForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Scheme" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/grants/schemes"));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/schemes");
    const body = JSON.parse((init as RequestInit).body as string);
    // GAP-GRANTS-SCHEMES-NEW-04: 500000 rupees -> 50000000 paise, no float error.
    expect(body.budgetMinor).toBe(50000000);
    expect(body.maxAmountMinor).toBe(10000000);
    // GAP-GRANTS-SCHEMES-NEW-03: sector/description are NOT sent (not persisted).
    expect(body).not.toHaveProperty("sector");
    expect(body).not.toHaveProperty("description");
    // GAP-GRANTS-SCHEMES-NEW-02: a reporting cycle default is included.
    expect(body.reportingFrequencyDays).toBe(90);
  });

  // GAP-GRANTS-SCHEMES-NEW-04: >2 decimals is rejected client-side, no POST.
  it("rejects a budget with more than two decimals", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));
    render(<CreateSchemeForm />);
    fillForm({ budget: "500000.555" });
    fireEvent.click(screen.getByRole("button", { name: "Create Scheme" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/up to 2 decimals/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-GRANTS-SCHEMES-NEW-02: max > budget is rejected.
  it("rejects a maximum grant larger than the total budget", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));
    render(<CreateSchemeForm />);
    fillForm({ budget: "100000", max: "200000" });
    fireEvent.click(screen.getByRole("button", { name: "Create Scheme" }));
    expect(await screen.findByText(/cannot exceed the total budget/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-GRANTS-SCHEMES-NEW-05: a malformed code is rejected inline.
  it("rejects an invalid scheme code format", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));
    render(<CreateSchemeForm />);
    fillForm({ code: "pm kisan" });
    fireEvent.click(screen.getByRole("button", { name: "Create Scheme" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/uppercase letters, digits and hyphens/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a clerk-safe error, not the raw server text, on a failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("grant-service: scheme code already exists", { status: 409 }),
    );

    render(<CreateSchemeForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Scheme" }));

    expect(await screen.findByText(/This grant scheme was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument();
    expect(screen.queryByText(/scheme code already exists/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
