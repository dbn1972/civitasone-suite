import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// RefreshErrorState's retry uses router.refresh(); a bare mock is enough.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AccountHierarchy } from "./AccountHierarchy";
import type { CRMAccountSummary } from "@civitasone/types";

const account: CRMAccountSummary = {
  id: "a1",
  name: "NDMA",
  industry: "Disaster Management",
  website: "https://ndma.gov.in",
  contactCount: 2,
  parentId: undefined,
} as unknown as CRMAccountSummary;

describe("AccountHierarchy outage vs empty (GAP-CRM-ACCOUNTS-01)", () => {
  it("on source='error' with no accounts shows a retry, not 'No hierarchy yet'", () => {
    render(<AccountHierarchy accounts={[]} source="error" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No hierarchy yet")).not.toBeInTheDocument();
  });

  it("on an empty live result still shows 'No hierarchy yet'", () => {
    render(<AccountHierarchy accounts={[]} source="api" />);
    expect(screen.getByText("No hierarchy yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("renders the tree when accounts are present", () => {
    render(<AccountHierarchy accounts={[account]} source="api" />);
    expect(screen.getByText("NDMA")).toBeInTheDocument();
    expect(screen.queryByText("No hierarchy yet")).not.toBeInTheDocument();
  });
});

describe("AccountHierarchy accessible nesting (GAP-CRM-ACCOUNTS-06)", () => {
  const parent: CRMAccountSummary = {
    id: "p1",
    name: "Ministry",
    industry: undefined,
    website: undefined,
    contactCount: 0,
    parentId: undefined,
  } as unknown as CRMAccountSummary;
  const child: CRMAccountSummary = {
    id: "c1",
    name: "Directorate",
    industry: undefined,
    website: undefined,
    contactCount: 1,
    parentId: "p1",
  } as unknown as CRMAccountSummary;

  it("renders no role='tree' / role='treeitem' / aria-selected markup", () => {
    const { container } = render(<AccountHierarchy accounts={[parent, child]} source="api" />);
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelector('[role="treeitem"]')).toBeNull();
    expect(container.querySelector('[aria-selected]')).toBeNull();
    // Announced as navigation named "Account hierarchy".
    expect(screen.getByRole("navigation", { name: "Account hierarchy" })).toBeInTheDocument();
  });

  it("places a child account inside a nested <ul> under its parent <li>", () => {
    render(<AccountHierarchy accounts={[parent, child]} source="api" />);
    const childLink = screen.getByRole("link", { name: "Directorate" });
    const parentLi = screen.getByRole("link", { name: "Ministry" }).closest("li");
    expect(parentLi).not.toBeNull();
    // The child link lives inside the parent's <li> (true nesting).
    expect(parentLi?.contains(childLink)).toBe(true);
    // And specifically inside a nested <ul> within that <li>.
    expect(parentLi?.querySelector("ul")?.contains(childLink)).toBe(true);
  });
});
