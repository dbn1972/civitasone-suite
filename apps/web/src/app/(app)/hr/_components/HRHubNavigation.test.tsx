import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { HRHubNavigation, buildQuickAccessHrefs, defaultCollapsedTitles } from "./HRHubNavigation";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

type TestCat = { title: string; icon: string; tiles: { title: string; href: string; description?: string }[] };
const cats: TestCat[] = [
  { title: "Core", icon: "👥", tiles: [
    { title: "Dashboard", href: "/hr/dashboard", description: "d" },
    { title: "Employees", href: "/hr/employees", description: "e" },
    { title: "Leave", href: "/hr/leave", description: "l" },
  ] },
  { title: "Time", icon: "📅", tiles: [{ title: "Holidays", href: "/hr/holidays", description: "h" }] },
  { title: "Pay", icon: "💰", tiles: [{ title: "Payroll", href: "/hr/payroll", description: "p" }] },
];

function renderHub(categories: TestCat[] = cats, messages: object = en, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <HRHubNavigation categories={categories} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { window.localStorage.clear(); push.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe("HRHubNavigation (GAP-HR-HOME-02/04/05/06)", () => {
  it("persists the collapsed set across a remount (HOME-02)", () => {
    const { unmount } = renderHub();
    fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
    expect(screen.getByRole("button", { name: /Pay/ })).toHaveAttribute("aria-expanded", "false");
    unmount();
    renderHub();
    expect(screen.getByRole("button", { name: /Pay/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Core/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("default-collapses all but the first two categories when there are >40 tiles (HOME-02)", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      title: `C${i}`, icon: "x",
      tiles: Array.from({ length: 11 }, (_, j) => ({ title: `T${i}-${j}`, href: `/hr/t${i}-${j}` })),
    }));
    expect(defaultCollapsedTitles(many)).toEqual(["C2", "C3"]);
    expect(defaultCollapsedTitles(cats)).toEqual([]);
  });

  it("puts the most recently opened tile first in Quick Access after reload (HOME-02)", () => {
    const { unmount } = renderHub();
    const quick = () => screen.getAllByRole("heading", { level: 2 })[0]!.nextElementSibling!;
    fireEvent.click(quick().querySelector('a[href="/hr/leave"]')!);
    unmount();
    renderHub();
    const first = quick().querySelector("a")!;
    expect(first).toHaveAttribute("href", "/hr/leave");
  });

  it("buildQuickAccessHrefs: recents first, falls back to defaults, drops unknown hrefs", () => {
    const known = new Set(["/hr/dashboard", "/hr/leave", "/hr/x"]);
    expect(buildQuickAccessHrefs(["/hr/x", "/hr/gone"], known)).toEqual(["/hr/x", "/hr/dashboard", "/hr/leave"]);
  });

  it("does not warn about duplicate keys and lists a duplicated href once in search (HOME-04)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const dup: TestCat[] = [
      cats[0]!,
      { title: "Setup", icon: "⚙️", tiles: [{ title: "Holidays", href: "/hr/holidays" }] },
      { title: "Time", icon: "📅", tiles: [{ title: "Holidays", href: "/hr/holidays" }] },
    ];
    renderHub(dup);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "holiday" } });
    expect(document.querySelectorAll('a[href="/hr/holidays"]')).toHaveLength(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
  });

  it("renders no hard-coded English chrome in Hindi (HOME-05)", () => {
    renderHub(cats, hi, "hi");
    expect(screen.queryByText("Quick Access")).toBeNull();
    expect(screen.getByRole("searchbox")).toHaveAttribute("aria-label", hi.hr.hubSearchLabel);
    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", hi.hr.hubSearchPlaceholder);
    expect(screen.getByText(hi.hr.hubQuickAccess)).toBeInTheDocument();
  });

  it("'/' focuses the search box but not while typing in another input (HOME-06)", () => {
    renderHub();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("Enter opens the first match (HOME-06)", () => {
    renderHub();
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "payroll" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/hr/payroll");
  });

  it("empty state suggests up to three Quick Access tiles (HOME-06)", () => {
    renderHub();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(screen.getByText(/No modules match/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});
