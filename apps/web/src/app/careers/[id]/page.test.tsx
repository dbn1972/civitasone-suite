import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
// ApplyForm is covered by its own tests; stub it so this file only exercises the page logic.
vi.mock("./ApplyForm", () => ({ ApplyForm: () => <div data-testid="apply-form" /> }));

import VacancyPage from "./page";
import { isClosed } from "./vacancy";

afterEach(() => { vi.unstubAllGlobals(); });

const V = { id: "v1", title: "Assistant", refNo: "R1", vacancyType: "regular", vacancies: 2 };
function stub(res: Response | Error) {
  vi.stubGlobal("fetch", vi.fn(async () => { if (res instanceof Error) throw res; return res.clone(); }));
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("vacancy detail page", () => {
  // GAP-RECRUITMENT-CAREERS-DETAIL-06
  it("a 500 from the backend renders a retry card, NOT the 404 page", async () => {
    stub(json({}, 500));
    render(await VacancyPage({ params: { id: "v1" } }));
    expect(screen.getByText(/Couldn.t load this vacancy/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Try again/ }).getAttribute("href")).toBe("/careers/v1");
  });

  it("a network failure / timeout also renders the retry card", async () => {
    stub(new Error("timeout"));
    render(await VacancyPage({ params: { id: "v1" } }));
    expect(screen.getByText(/Couldn.t load this vacancy/)).toBeTruthy();
  });

  it("a real 404 still calls notFound()", async () => {
    stub(json({ code: "NOT_FOUND" }, 404));
    await expect(VacancyPage({ params: { id: "v1" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // GAP-RECRUITMENT-CAREERS-DETAIL-08
  it("hides the Positions card when vacancies is 0", async () => {
    stub(json({ ...V, vacancies: 0, applicationOpen: true }));
    render(await VacancyPage({ params: { id: "v1" } }));
    expect(screen.queryByText("Positions")).toBeNull();
  });

  it("shows the Positions card when vacancies > 0", async () => {
    stub(json({ ...V, applicationOpen: true }));
    render(await VacancyPage({ params: { id: "v1" } }));
    expect(screen.getByText("Positions")).toBeTruthy();
  });

  it("applicationOpen=false shows the closed banner with the reason even when closesAt is in the future", async () => {
    stub(json({ ...V, closesAt: "2099-01-01", applicationOpen: false, closedReason: "the application deadline has passed" }));
    render(await VacancyPage({ params: { id: "v1" } }));
    expect(screen.getByRole("status").textContent).toMatch(/closed.*deadline has passed/i);
    expect(screen.queryByTestId("apply-form")).toBeNull();
  });

  it("applicationOpen=true shows the form even if closesAt (date only) looks past on the web clock", async () => {
    stub(json({ ...V, closesAt: "2000-01-01", applicationOpen: true }));
    render(await VacancyPage({ params: { id: "v1" } }));
    expect(screen.getByTestId("apply-form")).toBeTruthy();
  });

  it("falls back to the deadline date only when the backend omits applicationOpen", () => {
    expect(isClosed({ closesAt: "2000-01-01" })).toBe(true);
    expect(isClosed({ closesAt: "2099-01-01" })).toBe(false);
    expect(isClosed({})).toBe(false);
  });
});
