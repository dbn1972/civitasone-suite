import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FnfPage from "./page";

describe("FnfPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of F&F settlements", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "s1", employeeId: "e1", separationType: "retirement", separationDate: "2026-07-01", netPayableMinor: "500000", status: "settled" },
      ],
      source: "api",
    });

    const ui = await FnfPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    // The card's own separationType text is embedded in a compound sibling
    // text node ("e1 · retirement · 2026-07-01"), so RTL's default exact
    // getByText can't isolate "retirement" there -- assert on it with a
    // flexible text-content matcher instead of an exact string.
    expect(
      screen.getByText((_, node) => node?.textContent === "e1 · retirement · 2026-07-01"),
    ).toBeInTheDocument();
    // ComputeFnfForm's separation-type <select> now shows the translated,
    // properly-cased label ("Retirement") instead of the raw internal code
    // ("retirement") it used to render verbatim.
    expect(screen.getByText("Retirement")).toBeInTheDocument();
  });

  it("renders an empty state when there are no settlements", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await FnfPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("No F&F settlements yet")).toBeInTheDocument();
  });

  it("shows the error data-source badge on API failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await FnfPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Couldn't load F&F settlements — showing nothing")).toBeInTheDocument();
  });
});
