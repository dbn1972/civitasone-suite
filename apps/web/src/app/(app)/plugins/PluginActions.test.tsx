import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

import { PluginActions, MarketplaceInstallButton, lifecycleOf } from "./PluginActions";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
const withIntl = (ui: React.ReactElement, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{ui}</NextIntlClientProvider>
);


describe("PluginActions — GAP-PLUGINS-INSTALLED-01 (one primary action per lifecycle)", () => {
  beforeEach(() => mockRefresh.mockClear());

  it("enabled -> Disable only (no Install, no Enable)", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "enabled" }} />);
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
  });

  it("disabled -> Enable only", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "disabled" }} />);
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("available -> Install only (never offered on an enabled plugin)", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "available" }} />);
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
  });

  it("unknown status (error) -> no enable/disable button", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "error" }} />);
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("GAP-PLUGINS-INSTALLED-04: a row with no id shows explanatory text, not dead buttons", () => {
    render(<PluginActions plugin={{ name: "A", status: "enabled" }} />);
    expect(screen.getByText("Not manageable")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("GAP-PLUGINS-INSTALLED-02: canManage=false renders no controls at all", () => {
    const { container } = render(
      <PluginActions plugin={{ id: "p1", name: "A", status: "enabled" }} canManage={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("lifecycleOf", () => {
  it.each([
    ["enabled", "enabled"],
    ["active", "enabled"],
    ["disabled", "disabled"],
    ["available", "available"],
    ["not_installed", "available"],
    ["pending", "other"],
  ])("%s -> %s", (input, expected) => {
    expect(lifecycleOf(input)).toBe(expected);
  });
});

describe("MarketplaceInstallButton — GAP-PLUGINS-MARKETPLACE-01", () => {
  beforeEach(() => { mockRefresh.mockClear(); vi.restoreAllMocks(); });

  it("renders an Install control for an uninstalled listing when canManage", () => {
    render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" canManage />));
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("shows Installed (no button) for an already-installed listing", () => {
    render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" installed canManage />));
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(screen.getByText("Installed")).toBeInTheDocument();
  });

  it("renders nothing for a non-manager", () => {
    const { container } = render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" canManage={false} />));
    expect(container).toBeEmptyDOMElement();
  });

  function openDialog() {
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    return screen.getByRole("button", { name: "Request install" });
  }

  it("the confirm dialog requires a reason before Request install is enabled", () => {
    render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" canManage />));
    const confirm = openDialog();
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Needed for Q3 rollout" } });
    expect(confirm).toBeEnabled();
  });

  it("sends the reason, then says 'Install requested' (never 'Installed') on 202", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" canManage />));
    const confirm = openDialog();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Needed for Q3 rollout" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Install requested/));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/plugins/marketplace/m1/install",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Needed for Q3 rollout" }) }),
    );
    expect(screen.queryByText(/^Installed$/)).not.toBeInTheDocument();
  });

  it("polls install-status and flips to Installed only once the service reports it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const statuses = ["install_requested", "installed"];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (String(url).endsWith("/install-status")) return new Response(JSON.stringify({ data: { status: statuses.shift() ?? "installed" } }), { status: 200 });
        return new Response("{}", { status: 202 });
      });
      render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" canManage />));
      const confirm = openDialog();
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Needed for Q3 rollout" } });
      fireEvent.click(confirm);
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Install requested/));
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      expect(screen.getByRole("status")).toHaveTextContent(/Install requested/);
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      await waitFor(() => expect(screen.getByText("Installed")).toBeInTheDocument());
      expect(mockRefresh).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed request shows an error in the dialog and does not claim a requested install", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403, headers: { "content-type": "application/json" } }));
    render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" canManage />));
    const confirm = openDialog();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Needed for Q3 rollout" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders Hindi copy under the hi locale", () => {
    render(withIntl(<MarketplaceInstallButton listingId="m1" name="Billing" canManage />, "hi"));
    expect(screen.getByRole("button", { name: "इंस्टॉल करें" })).toBeInTheDocument();
  });
});
