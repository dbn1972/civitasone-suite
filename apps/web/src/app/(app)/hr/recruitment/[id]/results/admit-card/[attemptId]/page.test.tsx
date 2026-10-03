import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "job-1", attemptId: "t1" }) }));
import AdmitCardPage from "./page";

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><AdmitCardPage /></NextIntlClientProvider>);
afterEach(() => vi.unstubAllGlobals());

describe("Admit card page (DETAIL-14)", () => {
  it("renders the roll number, candidate, sitting window and instructions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {
      attemptId: "t1", rollNumber: "4444-333333", candidateName: "Asha Verma", applicationNo: "APP-2026-000042", examination: "Written Test - Assistant", mode: "online",
      windowStart: "2026-10-20T04:30:00.000Z", windowEnd: "2026-10-20T07:30:00.000Z", slotLabel: "Slot A", identityVerified: false, instructions: ["Carry a photo ID."],
    } }), { status: 200 })));
    renderPage();
    expect(await screen.findByText("4444-333333")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Written Test - Assistant")).toBeInTheDocument();
    expect(screen.getByText("Carry a photo ID.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/proxy/v1/hrms/assessments/attempts/t1/admit-card");
  });

  it("says why no card is available for a cancelled sitting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "ADMIT_CARD_UNAVAILABLE", message: "this assessment sitting was cancelled" }), { status: 409 })));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No admit card is available: this assessment sitting was cancelled.");
  });

  it("shows a generic failure when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 500 })));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });
});
