import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ContactReveal } from "./ContactReveal";

afterEach(() => vi.unstubAllGlobals());

function renderIt(props: Partial<React.ComponentProps<typeof ContactReveal>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ContactReveal applicationId="app-1" applicantName="Asha Verma" email="a***@e***.com" mobile="******3210" scope="inbox" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ContactReveal", () => {
  it("renders the masked values by default (the full address is nowhere in the DOM)", () => {
    renderIt();
    expect(screen.getByTestId("contact-app-1")).toHaveTextContent("a***@e***.com · ******3210");
    expect(document.body.textContent).not.toContain("asha@example.com");
    expect(screen.getByRole("button", { name: /reveal contact details for asha verma/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks for a reason, calls the audited reveal endpoint with it, then shows the full values", async () => {
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: { id: "app-1", email: "asha@example.com", mobile: "9876543210" } }), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /reveal contact details/i }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /reveal/i });
    expect(confirm).toBeDisabled(); // no reason yet
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "call to confirm interview slot" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId("contact-app-1")).toHaveTextContent("asha@example.com · 9876543210"));
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/hrms/applications/app-1/reveal-contact");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "call to confirm interview slot", scope: "inbox" });
    expect(screen.getByRole("button", { name: /hide contact details/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("a refused reveal (403) shows a permission message and leaves the values masked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 })));
    renderIt({ scope: "talent_pool" });
    fireEvent.click(screen.getByRole("button", { name: /reveal contact details/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "re-engage past applicant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /reveal/i }));
    expect(await within(dialog).findByText(/not permitted/i)).toBeInTheDocument();
    expect(screen.getByTestId("contact-app-1")).toHaveTextContent("a***@e***.com");
  });

  it("canReveal=false offers no button", () => {
    renderIt({ canReveal: false });
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
  });

  it("hiding re-masks the values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { email: "asha@example.com", mobile: "9876543210" } }), { status: 200 })));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /reveal contact details/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "verify before offer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /reveal/i }));
    await screen.findByRole("button", { name: /hide contact details/i });
    fireEvent.click(screen.getByRole("button", { name: /hide contact details/i }));
    expect(screen.getByTestId("contact-app-1")).toHaveTextContent("a***@e***.com");
  });
});
