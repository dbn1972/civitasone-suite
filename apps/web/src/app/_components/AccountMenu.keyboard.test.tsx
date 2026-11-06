import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AccountMenu } from "./AccountMenu";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/sync/logout", () => ({ performLogout: vi.fn().mockResolvedValue(undefined) }));

/** PR #2461 delta review: the phone-only Ask row (display:none above 480 px) must not trap ArrowUp/ArrowDown. */
describe("AccountMenu arrow keys skip a display:none row", () => {
  function open() {
    rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}><AccountMenu /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    return screen.getByRole("menu");
  }

  it("ArrowUp from Sign out never lands on the hidden Ask row, and ArrowDown wraps past it", () => {
    const menu = open();
    const ask = menu.querySelector<HTMLElement>(".am-ask")!;
    ask.style.display = "none";
    const signOut = screen.getByRole("menuitem", { name: "Sign out" });
    signOut.focus();
    fireEvent.keyDown(signOut, { key: "ArrowUp" });
    expect(document.activeElement).not.toBe(ask);
    expect(document.activeElement).not.toBe(signOut);
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
      expect(document.activeElement).not.toBe(ask);
    }
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      expect(document.activeElement).not.toBe(ask);
    }
  });

  it("when the Ask row is shown (phone) it is part of the cycle", () => {
    const menu = open();
    const ask = menu.querySelector<HTMLElement>(".am-ask")!;
    const signOut = screen.getByRole("menuitem", { name: "Sign out" });
    signOut.focus();
    fireEvent.keyDown(signOut, { key: "ArrowUp" });
    expect(document.activeElement).toBe(ask);
  });
});
