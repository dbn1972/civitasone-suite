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

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("@/messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

const roles: { current: string[] } = { current: [] };
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/roleGuard")>();
  return {
    ...actual,
    getSessionRoles: () => roles.current,
  };
});

import Page from "./page";

describe("themes hub (GAP-THEMES-HOME-02 / -04)", () => {
  beforeEach(() => {
    roles.current = [];
  });

  it("renders translated title and a 'who sees what' description", async () => {
    roles.current = ["theme_admin"];
    render(await Page());
    expect(screen.getByRole("heading", { name: "Themes" })).toBeInTheDocument();
    expect(screen.getByText(/Publishing tokens changes what every tenant screen shows/i)).toBeInTheDocument();
  });

  it("marks the two list routes as read-only", async () => {
    roles.current = ["theme_admin"];
    render(await Page());
    expect(screen.getByText(/View branding packs \(read-only\)/i)).toBeInTheDocument();
    expect(screen.getByText(/View the active brand \(read-only\)/i)).toBeInTheDocument();
  });

  it("shows the edit/publish tiles to an admin", async () => {
    roles.current = ["theme_admin"];
    render(await Page());
    expect(screen.getByText("Edit tenant brand")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
  });

  it("hides the edit brand + tokens-publish tiles from a non-admin theme_user", async () => {
    roles.current = ["theme_user"];
    render(await Page());
    expect(screen.queryByText("Edit tenant brand")).not.toBeInTheDocument();
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    // the read-only tiles remain visible
    expect(screen.getByText("Branding")).toBeInTheDocument();
  });
});
