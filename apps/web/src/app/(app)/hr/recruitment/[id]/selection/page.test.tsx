import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { resetSessionIdentityCache } from "@/lib/auth/useSessionIdentity";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "job-1" }) }));
import SelectionListsPage from "./page";

const LIST = { id: "l-1", title: "Merit list", vacancies: 1, status: "draft", validityUntil: null, createdBy: "maker-1", entriesSetBy: "maker-1" };
const APPS = [
  { id: "a1", applicantName: "Asha Verma", screeningDecision: "shortlisted" },
  { id: "a2", applicantName: "Rahul Singh", screeningDecision: "shortlisted" },
  { id: "a3", applicantName: "Pending Person", screeningDecision: "pending" },
];

type Opts = { session: { userId: string; roles: string[] }; list?: typeof LIST & Record<string, unknown>; entries?: unknown[]; write?: (url: string, method: string, body: unknown) => Response };
function stub({ session, list = LIST, entries = [], write }: Opts) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url); const method = init?.method ?? "GET";
    if (u === "/api/auth/session") return new Response(JSON.stringify({ authenticated: true, ...session }), { status: 200 });
    if (method === "GET" && u.endsWith("/selection-lists")) return new Response(JSON.stringify({ data: [list] }), { status: 200 });
    if (method === "GET" && u.endsWith("/applications")) return new Response(JSON.stringify({ data: APPS }), { status: 200 });
    if (method === "GET" && u.endsWith(`/selection-lists/${list.id}`)) return new Response(JSON.stringify({ ...list, entries }), { status: 200 });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    return write ? write(u, method, body) : new Response(JSON.stringify({}), { status: 200 });
  }));
  return calls;
}
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><SelectionListsPage /></NextIntlClientProvider>);

beforeEach(() => resetSessionIdentityCache());
afterEach(() => vi.unstubAllGlobals());

async function openList() {
  fireEvent.click(await screen.findByRole("button", { name: "Open" }));
  return await screen.findByRole("region", { name: "Merit list" });
}

describe("Selection lists page (DETAIL-14)", () => {
  it("creates a draft list for the vacancy", async () => {
    const calls = stub({ session: { userId: "maker-1", roles: ["hr_officer"] } });
    renderPage();
    fireEvent.change(await screen.findByLabelText("List title"), { target: { value: "Final merit list" } });
    fireEvent.change(screen.getByLabelText("Posts"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create list" }));
    await waitFor(() => expect(calls[0]).toEqual({ url: "/api/proxy/v1/hrms/job-openings/job-1/selection-lists", method: "POST", body: { title: "Final merit list", vacancies: 3 } }));
  });

  it("offers only the screened pool and saves a ranked list with auto-rank by score", async () => {
    const calls = stub({ session: { userId: "maker-1", roles: ["hr_officer"] } });
    renderPage();
    const region = await openList();
    expect(within(region).queryByText("Pending Person")).not.toBeInTheDocument();
    fireEvent.change(within(region).getByLabelText("Placement for Asha Verma"), { target: { value: "selected" } });
    fireEvent.change(within(region).getByLabelText("Placement for Rahul Singh"), { target: { value: "waitlist" } });
    fireEvent.change(within(region).getByLabelText("Score for Asha Verma"), { target: { value: "88" } });
    fireEvent.change(within(region).getByLabelText("Score for Rahul Singh"), { target: { value: "75" } });
    fireEvent.click(within(region).getByRole("button", { name: "Auto-rank by score" }));
    fireEvent.click(within(region).getByRole("button", { name: "Save ranking" }));
    await waitFor(() => expect(calls[0]?.method).toBe("PUT"));
    expect(calls[0]!.url).toBe("/api/proxy/v1/hrms/selection-lists/l-1/entries");
    expect(calls[0]!.body).toEqual({ entries: [
      { applicationId: "a1", candidateName: "Asha Verma", category: "selected", rank: 1, score: 88 },
      { applicationId: "a2", candidateName: "Rahul Singh", category: "waitlist", rank: 1, score: 75 },
    ] });
  });

  it("blocks a ranking with more selected candidates than posts, before any request", async () => {
    const calls = stub({ session: { userId: "maker-1", roles: ["hr_officer"] } });
    renderPage();
    const region = await openList();
    for (const [n, r] of [["Asha Verma", "1"], ["Rahul Singh", "2"]] as const) {
      fireEvent.change(within(region).getByLabelText(`Placement for ${n}`), { target: { value: "selected" } });
      fireEvent.change(within(region).getByLabelText(`Rank for ${n}`), { target: { value: r } });
    }
    fireEvent.click(within(region).getByRole("button", { name: "Save ranking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/more candidates are marked selected than there are posts/i);
    expect(calls).toHaveLength(0);
  });

  it("the list's creator cannot approve it (maker-checker): Approve is disabled with a reason", async () => {
    stub({ session: { userId: "maker-1", roles: ["hr_admin"] } });
    renderPage();
    const region = await openList();
    fireEvent.change(within(region).getByLabelText("Valid until"), { target: { value: "2099-01-31" } });
    expect(within(region).getByRole("button", { name: "Approve list" })).toBeDisabled();
    expect(within(region).getByText(/you created or ranked this list/i)).toBeInTheDocument();
  });

  it("an independent admin approves with a validity date; a service SoD refusal is shown in plain words", async () => {
    const calls = stub({
      session: { userId: "checker-2", roles: ["hr_admin"] },
      write: () => new Response(JSON.stringify({ code: "SOD_VIOLATION" }), { status: 403 }),
    });
    renderPage();
    const region = await openList();
    fireEvent.change(within(region).getByLabelText("Valid until"), { target: { value: "2099-01-31" } });
    fireEvent.click(within(region).getByRole("button", { name: "Approve list" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve list" }));
    await waitFor(() => expect(calls[0]).toEqual({ url: "/api/proxy/v1/hrms/selection-lists/l-1/approve", method: "POST", body: { validUntil: "2099-01-31T00:00:00.000Z" } }));
    expect(await within(dialog).findByText(/created the list or ranked it cannot approve it/i)).toBeInTheDocument();
  });

  it("an HR officer (not admin) sees no approve / publish / expire controls", async () => {
    stub({ session: { userId: "x", roles: ["hr_officer"] } });
    renderPage();
    const region = await openList();
    expect(await within(region).findByText(/needs an hr administrator/i)).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Approve list" })).not.toBeInTheDocument();
  });

  it("an approved list is published behind a confirmation", async () => {
    const calls = stub({ session: { userId: "checker-2", roles: ["hr_admin"] }, list: { ...LIST, status: "approved" }, entries: [{ applicationId: "a1", candidateName: "Asha Verma", category: "selected", rank: 1, score: null }] });
    renderPage();
    const region = await openList();
    expect(within(region).getByText(/Asha Verma · Selected #1/)).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Publish list" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish list" }));
    await waitFor(() => expect(calls[0]!.url).toBe("/api/proxy/v1/hrms/selection-lists/l-1/publish"));
  });
});
