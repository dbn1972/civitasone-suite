import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeActions } from "./ThemeActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// ConfirmDialog always renders an (empty) role="alert" live region for submit
// errors, so a bare role query matches it. Select only the contrast warning.
const wcagAlerts = () =>
  screen.queryAllByRole("alert").filter((el) => /WCAG AA/i.test(el.textContent ?? ""));

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
    expect(wcagAlerts()).toHaveLength(1);
    expect(wcagAlerts()[0]).toHaveTextContent(/fail WCAG AA/i);
  });

  it("shows NO WCAG alert when all colour pairs pass AA", async () => {
    const passTokens = [
      { key: "brand.primary", value: "#1a1a1a" },
      { key: "surface.canvas", value: "#ffffff" },
    ];
    render(<ThemeActions tokens={passTokens} />);
    await userEvent.click(screen.getByRole("button", { name: /publish theme/i }));
    expect(wcagAlerts()).toHaveLength(0);
  });

  it("shows NO WCAG alert when no tokens are provided", async () => {
    render(<ThemeActions />);
    await userEvent.click(screen.getByRole("button", { name: /publish theme/i }));
    expect(wcagAlerts()).toHaveLength(0);
  });
});

describe("ThemeActions — publish request (GAP-THEMES-TOKENS-02)", () => {
  async function publishWith(props: { expectedVersion?: number }, res: Response) {
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", fetchMock);
    render(<ThemeActions {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /publish theme/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /reason/i }), "Quarterly rebrand");
    await userEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    return fetchMock;
  }

  it("pins the revision the page was built on via expectedVersion", async () => {
    const fetchMock = await publishWith({ expectedVersion: 4 }, new Response(JSON.stringify({ version: 5 }), { status: 201 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ expectedVersion: 4, reason: "Quarterly rebrand" });
  });

  it("a stale-revision 409 is shown as a friendly message, never the raw server text", async () => {
    await publishWith(
      { expectedVersion: 4 },
      new Response(JSON.stringify({ code: "STALE_REVISION", message: "RAW-SERVER-DETAIL" }), { status: 409 }),
    );
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => (a.textContent ?? "").trim().length > 0)).toBe(true);
    expect(alerts.every((a) => !(a.textContent ?? "").includes("RAW-SERVER-DETAIL"))).toBe(true);
  });
});
