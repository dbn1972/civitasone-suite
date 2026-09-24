import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

const COLLAPSED_KEY = "civitas-sidebar-collapsed";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("Sidebar", () => {
  it("renders brand name", () => {
    render(<Sidebar />);
    expect(screen.getByText("CivitasOne")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Suite")).toBeInTheDocument();
  });

  it("renders all navigation groups when no module filtering", () => {
    render(<Sidebar />);
    expect(screen.getByText("OVERVIEW")).toBeInTheDocument();
    expect(screen.getByText("FINANCE")).toBeInTheDocument();
    expect(screen.getByText("OPERATIONS")).toBeInTheDocument();
    expect(screen.getByText("PLATFORM")).toBeInTheDocument();
  });

  it("renders navigation links", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /Finance/ })).toHaveAttribute("href", "/finance");
    expect(screen.getByRole("link", { name: /HR & Payroll/ })).toHaveAttribute("href", "/hr");
  });

  it("marks active item with 'on' class", () => {
    render(<Sidebar />);
    const dashLink = screen.getByRole("link", { name: /Dashboard/ });
    expect(dashLink).toHaveClass("on");
  });

  it("non-active items don't have 'on' class", () => {
    render(<Sidebar />);
    const financeLink = screen.getByRole("link", { name: /Finance/ });
    expect(financeLink).not.toHaveClass("on");
  });

  it("filters items by enabledModules", () => {
    render(<Sidebar enabledModules={["finance"]} />);
    // Finance should be visible
    expect(screen.getByRole("link", { name: /Finance/ })).toBeInTheDocument();
    // HR should NOT be visible (not in enabled list)
    expect(screen.queryByRole("link", { name: /HR & Payroll/ })).not.toBeInTheDocument();
  });

  it("always shows items with null moduleKey regardless of enabledModules", () => {
    render(<Sidebar enabledModules={["finance"]} />);
    // Dashboard has moduleKey: null, so always visible
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Help Centre/ })).toBeInTheDocument();
  });

  it("hides entire group when no items are visible", () => {
    render(<Sidebar enabledModules={[]} />);
    // FINANCE group should be hidden (finance module not enabled)
    expect(screen.queryByText("FINANCE")).not.toBeInTheDocument();
    // OVERVIEW always visible (null moduleKey items)
    expect(screen.getByText("OVERVIEW")).toBeInTheDocument();
  });

  it("shows all items when enabledModules is null (backward compatible)", () => {
    render(<Sidebar enabledModules={null} />);
    expect(screen.getByRole("link", { name: /Finance/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /HR & Payroll/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Procurement/ })).toBeInTheDocument();
  });

  it("renders user avatar in footer", () => {
    // userName/userRole are wired from the JWT via AppShell (C-03); the component
    // itself only supplies generic "User"/"Staff" fallbacks, so exercise it with
    // explicit props the way real callers do.
    render(<Sidebar userName="D. Nayak" userRole="Admin" />);
    expect(screen.getByText("D. Nayak")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  describe("module gating integration", () => {
    it("when enabledModules is ['finance'], sidebar only shows finance + always-visible items", () => {
      render(<Sidebar enabledModules={["finance"]} />);
      // Finance module items visible
      expect(screen.getByRole("link", { name: /Finance/ })).toBeInTheDocument();
      // Platform/overview items always visible
      expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Tenant Admin/ })).toBeInTheDocument();
      // Other modules hidden
      expect(screen.queryByRole("link", { name: /HR & Payroll/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Procurement/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /CRM/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Helpdesk/ })).not.toBeInTheDocument();
    });

    it("when enabledModules is null, sidebar shows all (backward compatible)", () => {
      render(<Sidebar enabledModules={null} />);
      expect(screen.getByRole("link", { name: /Finance/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /HR & Payroll/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Procurement/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /CRM/ })).toBeInTheDocument();
    });

    it("multiple enabled modules show their respective items", () => {
      render(<Sidebar enabledModules={["finance", "hrms", "projects"]} />);
      expect(screen.getByRole("link", { name: /Finance/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /HR & Payroll/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Projects/ })).toBeInTheDocument();
      // Procurement not enabled
      expect(screen.queryByRole("link", { name: /Procurement/ })).not.toBeInTheDocument();
    });
  });

  // Hydration safety: the collapsed-groups state must start at the same
  // server-safe default (nothing collapsed) on both server and client, and
  // only pick up a persisted localStorage value afterwards (in an effect).
  // Reading localStorage straight from the useState initializer -- the
  // previous shape of this code -- runs during the client's first render
  // too, so it'd disagree with what the server rendered and React would
  // flag a hydration mismatch. See Sidebar.tsx for the fuller note.
  //
  // The specific "the very first commit ignores a pre-seeded persisted
  // value" property is verified by direct code review rather than a test
  // here: a raw createRoot().render() left unwrapped from act() (the
  // standard way to observe React's pre-effect commit) turned out to not
  // be synchronous in this Vitest/jsdom setup, so that assertion couldn't
  // reliably distinguish the fix from the bug it fixes. The initializer
  // itself (`useState<Set<string>>(new Set())`, no function argument) is
  // plainly free of any localStorage/window read -- confirmed by reading
  // Sidebar.tsx directly.
  describe("collapsed-group persistence (hydration-safe)", () => {
    afterEach(() => {
      localStorage.removeItem(COLLAPSED_KEY);
    });

    it("applies a persisted collapsed group after mount, via the effect", () => {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["FINANCE"]));
      render(<Sidebar enabledModules={null} />);
      // Group header stays (only its items collapse away).
      expect(screen.getByText("FINANCE")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Finance$/ })).not.toBeInTheDocument();
    });

    it("defaults to fully expanded when nothing is persisted", () => {
      render(<Sidebar enabledModules={null} />);
      expect(screen.getByRole("link", { name: /^Finance$/ })).toBeInTheDocument();
    });

    it("tolerates corrupt localStorage content without crashing", () => {
      localStorage.setItem(COLLAPSED_KEY, "{not-json");
      expect(() => render(<Sidebar enabledModules={null} />)).not.toThrow();
      // Falls back to fully expanded rather than propagating the parse error.
      expect(screen.getByRole("link", { name: /^Finance$/ })).toBeInTheDocument();
    });
  });
});
