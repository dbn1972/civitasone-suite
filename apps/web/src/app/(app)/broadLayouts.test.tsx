import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// SF-20: layouts that are intentionally open to every signed-in user must keep their pages
// reachable (no redirect, no role check) and, for notifications, carry the module gate.
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock("./ModuleGate", () => ({
  ModuleGate: ({ moduleKey, children }: { moduleKey: string; children: React.ReactNode }) => (
    <div data-testid="module-gate" data-module={moduleKey}>{children}</div>
  ),
}));

import DashboardLayout from "./dashboard/layout";
import HelpLayout from "./help/layout";
import SettingsLayout from "./settings/layout";
import SetupLayout from "./setup/layout";
import NotificationsLayout from "./notifications/layout";

describe("open layouts (SF-20)", () => {
  it.each([
    ["dashboard", DashboardLayout],
    ["help", HelpLayout],
    ["settings", SettingsLayout],
    ["setup", SetupLayout],
  ])("%s renders for a session with no admin role and never redirects", (_n, Layout) => {
    render(<Layout>{"page body"}</Layout>);
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("notifications renders for every user inside the 'notification' module gate", () => {
    render(<NotificationsLayout>{"inbox"}</NotificationsLayout>);
    expect(screen.getByTestId("module-gate").getAttribute("data-module")).toBe("notification");
    expect(screen.getByText("inbox")).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
