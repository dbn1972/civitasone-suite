import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ApplicationExtras, scoreLine, type Scorecard } from "./ApplicationExtras";

const COMPETENCIES = [{ competency: "technical", weight: 60, maxScore: 10 }, { competency: "communication", weight: 40, maxScore: 10 }];
const CARD: Scorecard = {
  interviewId: "iv-1", roundNumber: 2, roundType: "technical", scheduledDate: "2026-10-01", status: "completed",
  competencies: COMPETENCIES, cutoffScore: 60, consolidated: true, panelScore: 72, recommendation: "recommend",
  blinded: false, submittedCount: 2, panelSize: 2,
  scores: [
    { interviewer: "Asha Panelist", scores: { technical: 8, communication: 7 }, overallScore: 76, comments: "Strong fundamentals" },
    { interviewer: "Panel member 2", scores: { technical: 6, communication: 7 }, overallScore: 66, comments: null },
  ],
};

function mockApi(scorecards: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/scorecards")) return scorecards();
    if (url.endsWith("/fee")) return new Response("{}", { status: 404 });
    if (url.endsWith("/offers")) return new Response(JSON.stringify({ data: [] }));
    throw new Error(`unexpected fetch ${url}`);
  }));
}
const renderIt = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><ApplicationExtras appId="app-1" /></NextIntlClientProvider>);

describe("scoreLine", () => {
  it("lists awarded scores in template order against their maximum, skipping unscored competencies", () => {
    expect(scoreLine({ communication: 7, technical: 8 }, COMPETENCIES)).toBe("technical 8/10 · communication 7/10");
    expect(scoreLine({ technical: 8 }, COMPETENCIES)).toBe("technical 8/10");
    expect(scoreLine({}, COMPETENCIES)).toBe("");
  });
});

describe("ApplicationExtras scorecards (GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-06)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each round with the panel score, recommendation, interviewer names, per-competency scores and comments", async () => {
    mockApi(() => new Response(JSON.stringify({ data: [CARD] })));
    renderIt();
    expect(await screen.findByText("Round 2")).toBeInTheDocument();
    expect(screen.getByText(/Panel score:/)).toHaveTextContent("72");
    expect(screen.getByText(/Cut-off 60/)).toBeInTheDocument();
    expect(screen.getByText("Asha Panelist")).toBeInTheDocument();
    expect(screen.getByText("technical 8/10 · communication 7/10")).toBeInTheDocument();
    expect(screen.getByText("Strong fundamentals")).toBeInTheDocument();
    expect(screen.getByText("Panel member 2")).toBeInTheDocument();
  });

  it("a blinded interview shows only the explanation -- no scores, no panel score", async () => {
    mockApi(() => new Response(JSON.stringify({ data: [{ ...CARD, blinded: true, scores: [], panelScore: null, recommendation: null, submittedCount: 1, panelSize: 3 }] })));
    renderIt();
    expect(await screen.findByText(/Scores are hidden until you submit your own score/)).toHaveTextContent("1 of 3");
    expect(screen.queryByText(/Panel score:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Asha Panelist")).not.toBeInTheDocument();
  });

  it("an unconsolidated interview says so instead of showing a zero", async () => {
    mockApi(() => new Response(JSON.stringify({ data: [{ ...CARD, consolidated: false, panelScore: null, recommendation: null, scores: [] }] })));
    renderIt();
    expect(await screen.findByText(/not consolidated yet/)).toBeInTheDocument();
    expect(screen.getByText("No scores have been submitted yet.")).toBeInTheDocument();
  });

  it("no interviews is an explicit empty state", async () => {
    mockApi(() => new Response(JSON.stringify({ data: [] })));
    renderIt();
    expect(await screen.findByText("No interviews have been scheduled for this application.")).toBeInTheDocument();
  });

  it("a failing scorecards call is a section error with Retry, and the other sections still render", async () => {
    let n = 0;
    mockApi(() => (n++ === 0 ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ data: [CARD] }))));
    renderIt();
    expect(await screen.findByText(/Could not load the interview scorecards/)).toBeInTheDocument();
    expect(screen.getByText("No fee has been assessed for this application.")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Could not load the interview scorecards/).querySelector("button")!);
    await waitFor(() => expect(screen.getByText("Round 2")).toBeInTheDocument());
  });

  it("a 403 reads as a permission note, not an error", async () => {
    mockApi(() => new Response("{}", { status: 403 }));
    renderIt();
    expect(await screen.findByText("You do not have access to interview scorecards.")).toBeInTheDocument();
  });
});
