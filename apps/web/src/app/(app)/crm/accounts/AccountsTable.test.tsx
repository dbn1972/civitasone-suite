import { describe, it, expect, vi, beforeEach } from "vitest";
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

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
// RefreshErrorState's retry uses router.refresh(); a bare mock is enough.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { useSeededResource } from "@/lib/sync/resource";
import { AccountsTable } from "./AccountsTable";
import type { CRMAccountSummary } from "@civitasone/types";

const mockedHook = vi.mocked(useSeededResource);

function seed(data: CRMAccountSummary[], provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  } as unknown as ReturnType<typeof useSeededResource>);
}

const account: CRMAccountSummary = {
  id: "a1",
  name: "NDMA",
  industry: "Disaster Management",
  website: "https://ndma.gov.in",
  contactCount: 2,
  parentId: undefined,
} as unknown as CRMAccountSummary;

describe("AccountsTable outage vs empty (GAP-CRM-ACCOUNTS-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("on error-no-data shows a retry, never the 'No accounts yet' empty copy", () => {
    seed([], "error-no-data");
    render(<AccountsTable accounts={[]} source="error" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  });

  it("on a legitimately empty live result shows the empty state, no retry", () => {
    seed([], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("renders rows when data is present", () => {
    seed([account], "live");
    render(<AccountsTable accounts={[account]} source="api" />);
    expect(screen.getByText("NDMA")).toBeInTheDocument();
    expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  });
});
