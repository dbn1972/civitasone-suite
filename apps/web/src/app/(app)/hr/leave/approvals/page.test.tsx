import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-HR-LEAVE-APPROVALS-05: page.tsx had no role gate at all before this
// fix — an employee opening the URL saw whatever the panel's own fetches
// produced (empty/failing) instead of an honest PermissionDenied. The panel
// itself is irrelevant to this test, so stub it out (its own fetches would
// otherwise need a full mock just to satisfy this role-gate check).
vi.mock("./LeaveApprovalsPanel", () => ({
  LeaveApprovalsPanel: () => <div data-testid="panel">panel</div>,
}));

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

// next-intl/server resolves to a throwing guard under plain Vitest (no
// `react-server` condition) — a pre-existing, unrelated gap; same minimal
// same-shape mock already used by apply/page.test.tsx and
// citizen/alerts/page.test.tsx.
vi.mock("next-intl/server", async () => {
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  function resolve(obj: unknown, dotted: string): unknown {
    return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  }
  return {
    getTranslations: async (namespace?: string) => {
      const scope = namespace ? resolve(messages, namespace) : messages;
      return (key: string) => {
        const found = resolve(scope, key);
        return typeof found === "string" ? found : key;
      };
    },
  };
});

import LeaveApprovalsPage from "./page";

function render(page: ReturnType<typeof LeaveApprovalsPage>) {
  return Promise.resolve(page).then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

describe("LeaveApprovalsPage — role gate (GAP-HR-LEAVE-APPROVALS-05)", () => {
  afterEach(() => { mockRoles = []; });

  it("shows PermissionDenied for a plain employee — the panel itself never mounts", async () => {
    mockRoles = ["employee"];
    await render(LeaveApprovalsPage());
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
  });

  it("renders the panel for manager", async () => {
    mockRoles = ["manager"];
    await render(LeaveApprovalsPage());
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
  });

  it("renders the panel for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await render(LeaveApprovalsPage());
    expect(screen.getByTestId("panel")).toBeInTheDocument();
  });
});
