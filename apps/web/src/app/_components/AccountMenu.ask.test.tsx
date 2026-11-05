import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AccountMenu } from "./AccountMenu";
import { ASK_OPEN_EVENT } from "./AskCivitasOne";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("@/lib/sync/logout", () => ({ performLogout: vi.fn().mockResolvedValue(undefined) }));

/** PR #2461 review SHOULD-FIX 3: below 480 px Ask moves into the Account menu (CSS shows .am-ask there). */
describe("AccountMenu Ask row", () => {
  it("has an Ask CivitasOne menu item that opens the assistant and closes the menu", () => {
    const opened = vi.fn();
    window.addEventListener(ASK_OPEN_EVENT, opened);
    rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}><AccountMenu /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    const item = screen.getByRole("menuitem", { name: "Ask CivitasOne" });
    expect(item).toHaveClass("am-ask");
    fireEvent.click(item);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    window.removeEventListener(ASK_OPEN_EVENT, opened);
  });

  it("is translated in Hindi", () => {
    rtlRender(<NextIntlClientProvider locale="hi" messages={hiMessages}><AccountMenu /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: hiMessages.appNav.topbar.accountMenu }));
    expect(screen.getByRole("menuitem", { name: hiMessages.appNav.topbar.askMenu })).toBeInTheDocument();
  });
});
