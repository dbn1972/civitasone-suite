import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LocationRowActions } from "./LocationRowActions";

function ui(props: { archived?: boolean } = {}, messages: Record<string, unknown> = enMessages, locale = "en") {
  return render(<NextIntlClientProvider locale={locale} messages={messages}><LocationRowActions id="loc-1" name="HQ" {...props} /></NextIntlClientProvider>);
}

describe("LocationRowActions (GAP-HR-LOCATIONS-02)", () => {
  beforeEach(() => refresh.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("offers Edit (a link to the edit page) and Archive for an active location", () => {
    ui();
    expect(screen.getByRole("link", { name: "Edit HQ" })).toHaveAttribute("href", "/hr/locations/loc-1/edit");
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("offers nothing for an already archived location", () => {
    ui({ archived: true });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("renders from the hi messages too (no hardcoded English)", () => {
    ui({}, hiMessages as Record<string, unknown>, "hi");
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("link").textContent).not.toBe("Edit");
  });

  async function archiveWith(res: Response) {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(res)));
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "Merged into HQ" } });
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Archive location")!);
    return dialog;
  }

  it("explains an active-children refusal in plain language", async () => {
    const d = await archiveWith(new Response(JSON.stringify({ code: "HAS_ACTIVE_CHILDREN" }), { status: 409 }));
    await waitFor(() => expect(d).toHaveTextContent(/still has active sub-locations/i));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never shows a raw status or server text for any other failure", async () => {
    const d = await archiveWith(new Response("trace at line 9", { status: 500 }));
    await waitFor(() => expect(d).toHaveTextContent(/couldn't save/i));
    expect(d.textContent).not.toMatch(/trace at line|HTTP 500|status 500/);
  });
});
