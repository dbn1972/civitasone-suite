import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeActions } from "./ThemeActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("ThemeActions — contrast warning (GAP-THEMES-TOKENS-03)", () => {
  it("shows a WCAG AA alert in the confirm dialog when tokens fail AA", async () => {
    const failTokens = [
      { key: "brand.primary", value: "#777777" },
      { key: "surface.canvas", value: "#ffffff" },
    ];
    render(<ThemeActions tokens={failTokens} />);
    // Click "Publish theme" to open the confirm dialog
    await userEvent.click(screen.getByRole("button", { name: /publish theme/i }));
    // The alert must appear inside the open dialog
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/fail WCAG AA/i);
  });

  it("shows NO WCAG alert when all colour pairs pass AA", async () => {
    const passTokens = [
      { key: "brand.primary", value: "#1a1a1a" },
      { key: "surface.canvas", value: "#ffffff" },
    ];
    render(<ThemeActions tokens={passTokens} />);
    await userEvent.click(screen.getByRole("button", { name: /publish theme/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows NO WCAG alert when no tokens are provided", async () => {
    render(<ThemeActions />);
    await userEvent.click(screen.getByRole("button", { name: /publish theme/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
