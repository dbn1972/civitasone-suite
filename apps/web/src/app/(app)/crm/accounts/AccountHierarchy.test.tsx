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
