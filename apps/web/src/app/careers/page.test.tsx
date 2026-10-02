import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import CareersPage from "./page";

afterEach(() => { vi.unstubAllGlobals(); });

type V = { id: string; title: string; refNo: string; vacancyType: string; vacancies: number; location?: string; closesAt?: string; qualification?: string; payRange?: string };
const vac = (o: Partial<V> & { id: string }): V => ({ title: `Post ${o.id}`, refNo: `R-${o.id}`, vacancyType: "regular", vacancies: 1, ...o });

function stub(list: V[] | "error") {
  vi.stubGlobal("fetch", vi.fn(async () => list === "error"
    ? new Response("{}", { status: 503 })
    : new Response(JSON.stringify({ data: list }), { status: 200 })));
}
async function renderPage(sp: { type?: string; q?: string; page?: string } = {}) {
  const el = await CareersPage({ searchParams: sp });
  return render(el);
}
const chip = (name: RegExp) => within(screen.getByRole("navigation", { name: /filter by vacancy type/i })).queryByRole("link", { name });

describe("careers home", () => {
  // GAP-RECRUITMENT-CAREERS-HOME-01
  it("offers Contractual and Deputation chips (with counts) when such vacancies exist", async () => {
    stub([vac({ id: "1", vacancyType: "deputation" }), vac({ id: "2", vacancyType: "contractual" }), vac({ id: "3", vacancyType: "contractual" })]);
    await renderPage();
    expect(chip(/^Deputation/)!.getAttribute("href")).toBe("/careers?type=deputation");
    expect(chip(/^Contractual/)!.textContent).toContain("2");
    expect(chip(/^Internship/)).toBeNull(); // zero-count chips are hidden
  });

  it("a deputation vacancy is reachable via the Deputation filter and chip counts match the cards", async () => {
    stub([vac({ id: "1", vacancyType: "deputation" }), vac({ id: "2", vacancyType: "regular" })]);
    await renderPage({ type: "deputation" });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(chip(/^Deputation/)!.getAttribute("aria-current")).toBe("page");
  });

  // GAP-RECRUITMENT-CAREERS-HOME-03
  it("meta emoji are aria-hidden and each value has a visually hidden label", async () => {
    stub([vac({ id: "1", location: "Bhubaneswar", payRange: "Level 6", vacancies: 3, qualification: "B.Sc." })]);
    const { container } = await renderPage();
    const meta = container.querySelector("article")!.textContent!;
    expect(meta).toContain("Location: Bhubaneswar");
    expect(meta).toContain("Qualification: B.Sc.");
    for (const emoji of ["📍", "💰", "👥", "🎓"]) {
      const holder = Array.from(container.querySelectorAll("article span")).find((s) => s.textContent?.includes(emoji) && s.getAttribute("aria-hidden") === "true");
      expect(holder, emoji).toBeTruthy();
    }
  });

  // GAP-RECRUITMENT-CAREERS-HOME-04
  it("filter with no matches shows a filter-specific message and a link back, not 'No openings right now'", async () => {
    stub([vac({ id: "1", vacancyType: "regular" })]);
    await renderPage({ type: "internship" });
    expect(screen.getByRole("heading", { name: /No Internship openings/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /View all openings/ }).getAttribute("href")).toBe("/careers");
    expect(screen.queryByText(/No openings right now/)).toBeNull();
  });

  it("a tenant with nothing published still shows 'No openings right now'", async () => {
    stub([]);
    await renderPage();
    expect(screen.getByText(/No openings right now/)).toBeTruthy();
  });

  it("a service outage shows the retry card, not an empty state", async () => {
    stub("error");
    await renderPage();
    expect(screen.getByText(/Couldn.t load openings/)).toBeTruthy();
  });

  // GAP-RECRUITMENT-CAREERS-HOME-05
  it("search narrows by title, sorts closing-soonest first, and pages at 20", async () => {
    const list = [
      ...Array.from({ length: 25 }, (_, i) => vac({ id: String(i + 1), title: `Clerk ${i + 1}`, closesAt: `2026-12-${String((i % 25) + 1).padStart(2, "0")}` })),
      vac({ id: "x", title: "Engineer" }),
    ];
    stub(list);
    const first = await renderPage({ q: "clerk" });
    expect(screen.getAllByRole("article")).toHaveLength(20);
    expect(screen.queryByText("Engineer")).toBeNull();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 })[0]!.textContent).toBe("Clerk 1"); // 2026-12-01 first
    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href")).toBe("/careers?q=clerk&page=2");
    first.unmount();
    await renderPage({ q: "clerk", page: "2" });
    expect(screen.getAllByRole("article")).toHaveLength(5);
  });

  // GAP-RECRUITMENT-CAREERS-HOME-08
  it("footer text uses the AA-contrast muted token, not #94a3b8", async () => {
    stub([]);
    const { container } = await renderPage();
    const footer = container.querySelector("footer")!;
    expect(footer.getAttribute("style")).not.toMatch(/94a3b8|148, 163, 184/i);
  });
});
