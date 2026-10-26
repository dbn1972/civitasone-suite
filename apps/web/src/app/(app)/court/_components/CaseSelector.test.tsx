import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const render = (ui: ReactElement, locale: "en" | "hi" = "en") =>
  rtlRender(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      {ui}
    </NextIntlClientProvider>,
  );

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const searchCasesMock = vi.fn();
vi.mock("../_data/client", () => ({
  searchCases: (...args: unknown[]) => searchCasesMock(...args),
}));

import { CaseSelector } from "./CaseSelector";
import type { CourtCase } from "../_data/types";

const c1: CourtCase = {
  id: "case-1",
  cnrNumber: "DLHC010000012026",
  caseType: "civil",
  filingNumber: "F/1/2026",
  filingDate: "2026-01-05",
  title: "State vs. Sharma",
  status: "pending",
  stage: null,
  courtId: "court-1",
  benchId: null,
  disposalDate: null,
  targetDisposalDate: null,
  version: 1,
};

describe("CaseSelector", () => {
  beforeEach(() => {
    pushMock.mockReset();
    searchCasesMock.mockReset();
  });

  it("renders a genuine empty state when there are no cases and the fetch succeeded", () => {
    render(<CaseSelector cases={[]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText("No cases to pick from")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge (not the register-a-case copy) when the cases fetch failed", () => {
    render(<CaseSelector cases={[]} casesSource="error" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your cases")).toBeInTheDocument();
    expect(screen.queryByText("No cases to pick from")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge even if a stale (non-empty) case list is passed alongside an error source", () => {
    render(<CaseSelector cases={[c1]} casesSource="error" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.queryByLabelText("Case")).not.toBeInTheDocument();
  });

  it("lists cases and navigates to the base path with the chosen caseId", () => {
    render(<CaseSelector cases={[c1]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Sharma" } });
    // Pick the filtered option (role=option → button).
    fireEvent.mouseDown(screen.getByRole("option", { name: /State vs\. Sharma/ }).querySelector("button")!);
    expect(pushMock).toHaveBeenCalledWith("/court/hearings?caseId=case-1");
  });

  it("filters options as the user types (searchable combobox)", () => {
    const c2: CourtCase = { ...c1, id: "case-2", title: "Rao v. State", cnrNumber: "DLHC020000022026" };
    render(<CaseSelector cases={[c1, c2]} casesSource="api" basePath="/court/orders" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Rao" } });
    expect(screen.getByRole("option", { name: /Rao v\. State/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /State vs\. Sharma/ })).not.toBeInTheDocument();
  });

  it("reaches a case beyond the preloaded list via server-side search (GAP-COURT-HEARINGS-02)", async () => {
    const far: CourtCase = { ...c1, id: "case-150", title: "Far Away v. State", cnrNumber: "DLHC150000152026" };
    searchCasesMock.mockResolvedValue([far]);
    render(<CaseSelector cases={[c1]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "DLHC15000015" } });
    const opt = await screen.findByRole("option", { name: /Far Away v\. State/ });
    expect(searchCasesMock).toHaveBeenCalledWith("DLHC15000015", expect.anything());
    fireEvent.mouseDown(opt.querySelector("button")!);
    expect(pushMock).toHaveBeenCalledWith("/court/hearings?caseId=case-150");
  });

  it("shows a search error (not 'no matches') when the server search fails", async () => {
    searchCasesMock.mockRejectedValue(new Error("boom: 500 internal"));
    render(<CaseSelector cases={[c1]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz" } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Search is unavailable right now");
    expect(alert).not.toHaveTextContent("boom");
    expect(screen.queryByText("No matching cases")).not.toBeInTheDocument();
  });

  it("shows 'No matching cases' when the server search succeeds with zero rows", async () => {
    searchCasesMock.mockResolvedValue([]);
    render(<CaseSelector cases={[c1]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "nothing-here" } });
    expect(await screen.findByText("No matching cases")).toBeInTheDocument();
  });

  it("is operable by keyboard: ArrowDown moves the active option, Enter picks, Escape closes", () => {
    const c2: CourtCase = { ...c1, id: "case-2", title: "Rao v. State", cnrNumber: "DLHC020000022026" };
    render(<CaseSelector cases={[c1, c2]} casesSource="api" basePath="/court/orders" selectedCaseId="" />);
    const input = screen.getByLabelText("Case");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/court/orders?caseId=case-2");

    fireEvent.change(input, { target: { value: "Sharma" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders its labels from the active locale (hi), not hard-coded English", () => {
    render(<CaseSelector cases={[c1]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />, "hi");
    expect(screen.queryByLabelText("Case")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("combobox").getAttribute("placeholder")).not.toBe("Search by title or CNR…");
  });

  it("shows the truncation notice only when the preloaded list is at the 100 cap", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...c1, id: `c-${i}`, cnrNumber: `CNR${i}` }));
    const { unmount } = render(<CaseSelector cases={many} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.getByText(/first 100 cases/i)).toBeInTheDocument();
    unmount();
    render(<CaseSelector cases={[c1]} casesSource="api" basePath="/court/hearings" selectedCaseId="" />);
    expect(screen.queryByText(/first 100 cases/i)).not.toBeInTheDocument();
  });
});
