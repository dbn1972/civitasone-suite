import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { NewAlertButton, PublishWithdrawActions } from "./EngagementActions";

function ui(node: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>);
}
function stubFetch(status = 202, body: unknown = { id: "x", status: "accepted" }) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("PublishWithdrawActions", () => {
  beforeEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

  it("offers Publish and Withdraw for a draft, only Withdraw once published, nothing once withdrawn", () => {
    const a = ui(<PublishWithdrawActions kind="alerts" id="a1" status="draft" />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    a.unmount();
    const b = ui(<PublishWithdrawActions kind="alerts" id="a1" status="published" />);
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    b.unmount();
    const c = ui(<PublishWithdrawActions kind="alerts" id="a1" status="withdrawn" />);
    expect(c.container).toBeEmptyDOMElement();
  });

  it("publishes a draft alert via POST /alerts/:id/publish after confirmation, then refreshes", async () => {
    const fetchMock = stubFetch();
    ui(<PublishWithdrawActions kind="alerts" id="a-1" status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/proxy/v1/citizen/alerts/a-1/publish");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows plain language (no raw server text) when the service refuses, e.g. maker-checker 403", async () => {
    stubFetch(403, { code: "FORBIDDEN", message: "maker-checker: the creator of an alert cannot publish it" });
    ui(<PublishWithdrawActions kind="alerts" id="a-1" status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publish" }));
    const alert = await screen.findByText(/couldn.t|not allowed|permission/i);
    expect(alert.textContent).not.toMatch(/maker-checker|FORBIDDEN|403/);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("authoring forms", () => {
  beforeEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

  it("New alert posts the trimmed draft to /alerts and keeps Save disabled until a title is entered", async () => {
    const fetchMock = stubFetch();
    ui(<NewAlertButton />);
    fireEvent.click(screen.getByRole("button", { name: "New alert" }));
    const save = await screen.findByRole("button", { name: "Save draft" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Water outage  " } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Utilities" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save draft" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/proxy/v1/citizen/alerts");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ title: "Water outage", category: "Utilities" });
  });
});
