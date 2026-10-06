import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAdminSettingsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getAdminSettings: () => getAdminSettingsMock(),
}));

vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: () => undefined,
  PLATFORM_ADMIN_ROLES: ["platform_admin", "super_admin", "tenant_admin"],
}));

import SystemSettingsRoute from "./page";

const SETTINGS = {
  general: { configured: true, version: 1, values: { orgName: "Dept X" } },
  email: { configured: true, version: 1, values: { smtpHost: "smtp.x.in" } },
  security: { configured: true, version: 1, values: { mfaRequired: true } },
  integrations: { configured: true, version: 1, values: { pfmsUrl: "https://p", digiLockerEnabled: true } },
  hasSmtpPassword: true,
  logo: { present: false, contentType: null, sizeBytes: null },
};

describe("SystemSettingsRoute (GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-02/03)", () => {
  beforeEach(() => getAdminSettingsMock.mockReset());

  it("derives stat tiles from loaded settings (MFA Required, real SMTP host), not literals", async () => {
    getAdminSettingsMock.mockResolvedValue({ data: SETTINGS, source: "api" });
    render((await SystemSettingsRoute()) as React.ReactElement);
    expect(screen.getAllByText("smtp.x.in").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
    // Old literals are gone.
    expect(screen.queryByText("smtp.nic.in")).not.toBeInTheDocument();
    expect(screen.queryByText("MFA on")).not.toBeInTheDocument();
    expect(screen.queryByText("3 connected")).not.toBeInTheDocument();
  });

  it("renders a retry state on a load error (never fabricated tiles)", async () => {
    getAdminSettingsMock.mockResolvedValue({ data: null, source: "error" });
    render((await SystemSettingsRoute()) as React.ReactElement);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("MFA on")).not.toBeInTheDocument();
  });
});
