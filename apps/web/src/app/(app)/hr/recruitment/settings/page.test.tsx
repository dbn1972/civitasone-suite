import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import RecruitmentSettingsPage from "./page";

afterEach(() => vi.unstubAllGlobals());
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><RecruitmentSettingsPage /></NextIntlClientProvider>);
const SETTINGS = { organisationName: "Government of Odisha", departmentName: null, emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: null };

function stub(put?: (body: unknown) => Response) {
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ data: SETTINGS }), { status: 200 });
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return put ? put(body) : new Response(JSON.stringify({}), { status: 202 });
  }));
  return calls;
}

describe("Recruitment settings page", () => {
  it("loads the current settings and saves a change as one PUT (blank fields cleared)", async () => {
    const calls = stub();
    renderPage();
    const org = await screen.findByLabelText("Organisation name");
    expect(org).toHaveValue("Government of Odisha");
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "Housing & Urban Development" } });
    fireEvent.click(screen.getByLabelText(/offers must go through the approval workflow/i));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ organisationName: "Government of Odisha", departmentName: "Housing & Urban Development", emblemUrl: null, offerWorkflowRequired: false, applicantPurposeNote: null });
    expect(await screen.findByText(/settings saved/i)).toBeInTheDocument();
  });

  it("rejects an emblem that is not https before sending anything", async () => {
    const calls = stub();
    renderPage();
    fireEvent.change(await screen.findByLabelText(/emblem/i), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/https/i);
    expect(calls).toHaveLength(0);
  });

  it("a non-admin gets a plain permission message from the service's 403", async () => {
    stub(() => new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    renderPage();
    await screen.findByLabelText("Organisation name");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/hr administrator/i);
  });

  it("a failed load offers Retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
