import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "job-1" }) }));
import VacancyResultsPage from "./page";

const APPS = [{ id: "a1", applicantName: "Asha Verma" }, { id: "a2", applicantName: "Rahul Singh" }];
const attempt = (over: Record<string, unknown>) => ({ id: "t1", applicationId: "a1", status: "evaluated", result: "pass", slotLabel: null, frozen: false, published: false, ...over });

function stub(attempts: unknown[], post?: (url: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if ((init?.method ?? "GET") === "GET") {
      if (u.endsWith("/applications")) return new Response(JSON.stringify({ data: APPS }), { status: 200 });
      if (u.includes("/assessments/schedules?")) return new Response(JSON.stringify({ data: [{ id: "s1", title: "Written test", status: "open", windowStart: "2026-10-20T04:30:00Z" }] }), { status: 200 });
      if (u.endsWith("/assessments/schedules/s1")) return new Response(JSON.stringify({ attempts }), { status: 200 });
    }
    calls.push(u);
    return post ? post(u) : new Response(JSON.stringify({}), { status: 200 });
  }));
  return calls;
}
const renderPage = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><VacancyResultsPage /></NextIntlClientProvider>);
afterEach(() => vi.unstubAllGlobals());

async function chooseSchedule() {
  fireEvent.change(await screen.findByLabelText("Assessment sitting"), { target: { value: "s1" } });
}

describe("Vacancy results page (DETAIL-14)", () => {
  it("lists only this vacancy's applicants' attempts and links their admit cards", async () => {
    stub([attempt({}), attempt({ id: "t2", applicationId: "someone-else" })]);
    renderPage();
    await chooseSchedule();
    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + one applicant
    expect(screen.getByRole("link", { name: "Admit card for Asha Verma" })).toHaveAttribute("href", "/hr/recruitment/job-1/results/admit-card/t1");
  });

  it("offers consolidate and freeze for an evaluated result; freezing is confirmed first", async () => {
    const calls = stub([attempt({})]);
    renderPage();
    await chooseSchedule();
    expect(await screen.findByRole("button", { name: "Consolidate the result for Asha Verma" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Freeze the result for Asha Verma" }));
    expect(calls).toHaveLength(0);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Freeze" }));
    await waitFor(() => expect(calls[0]).toBe("/api/proxy/v1/hrms/assessments/attempts/t1/freeze"));
  });

  it("a frozen result can be published, and the service's SoD refusal on freeze is explained", async () => {
    stub([attempt({ frozen: true })]);
    renderPage();
    await chooseSchedule();
    expect(await screen.findByRole("button", { name: "Publish the result for Asha Verma" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /freeze the result/i })).not.toBeInTheDocument();
  });

  it("shows the freeze refusal for the moderation approver in plain words", async () => {
    stub([attempt({})], () => new Response(JSON.stringify({ code: "SOD_VIOLATION" }), { status: 403 }));
    renderPage();
    await chooseSchedule();
    fireEvent.click(await screen.findByRole("button", { name: "Freeze the result for Asha Verma" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Freeze" }));
    expect(await within(dialog).findByText(/approved the moderation cannot also freeze/i)).toBeInTheDocument();
  });

  it("a published result has no further actions", async () => {
    stub([attempt({ frozen: true, published: true })]);
    renderPage();
    await chooseSchedule();
    await screen.findByText("Asha Verma");
    expect(screen.queryByRole("button", { name: /the result for/i })).not.toBeInTheDocument();
  });
});
