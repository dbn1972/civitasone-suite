import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { GOIReservationCard, categoryOfApplication } from "./GOIReservationCard";

function renderCard(props: Partial<React.ComponentProps<typeof GOIReservationCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GOIReservationCard jobOpeningId="job-1" totalVacancies={20} {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("GOIReservationCard (GAP-RECRUITMENT-DETAIL-03)", () => {
  it("renders the sanctioned roster incl. EWS and UR, with no PH row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "approved", totalVacancies: 20, categoryVacancies: { UR: 9, SC: 3, ST: 2, OBC: 4, EWS: 2 } }), { status: 200 })));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    await waitFor(() => expect(screen.getByText("EWS")).toBeInTheDocument());
    expect(screen.getByText("UR")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByText("PH")).not.toBeInTheDocument();
    expect(screen.getByText("9 posts")).toBeInTheDocument();
    // approved roster cannot be edited or re-approved
    expect(screen.queryByRole("button", { name: /approve roster/i })).not.toBeInTheDocument();
  });

  it("with no roster (404) labels the statutory percentages as guidance only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 })));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    expect(await screen.findByText(/guidance only, not a sanctioned roster/i)).toBeInTheDocument();
    expect(screen.getByText("10%", { exact: false })).toBeInTheDocument(); // EWS
  });

  it("saves a draft roster only when category posts add up to the vacancy total", async () => {
    let put: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") { put = JSON.parse(String(init.body)); return new Response("{}", { status: 200 }); }
      return new Response("{}", { status: 404 });
    }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    fireEvent.click(await screen.findByRole("button", { name: /set roster/i }));
    const save = screen.getByRole("button", { name: /save draft roster/i });
    expect(save).toBeDisabled();
    for (const [cat, n] of Object.entries({ UR: "10", SC: "3", ST: "2", OBC: "4", EWS: "1" })) {
      fireEvent.change(screen.getByLabelText(`${cat} posts`), { target: { value: n } });
    }
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(put).toBeTruthy());
    expect(put).toEqual({ totalVacancies: 20, categoryVacancies: { UR: 10, SC: 3, ST: 2, OBC: 4, EWS: 1 }, horizontalVacancies: {} });
  });

  it("shows a plain message when the roster creator tries to approve (SoD)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ code: "SOD_VIOLATION", message: "x" }), { status: 403 });
      return new Response(JSON.stringify({ status: "draft", totalVacancies: 20, categoryVacancies: { UR: 20 } }), { status: 200 });
    }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    fireEvent.click(await screen.findByRole("button", { name: /approve roster/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can't approve it/i);
  });
});

describe("categoryOfApplication", () => {
  it("maps synonyms and fails closed on unknown values", () => {
    expect(categoryOfApplication("General")).toBe("UR");
    expect(categoryOfApplication("OBC-NCL")).toBe("OBC");
    expect(categoryOfApplication("ews")).toBe("EWS");
    expect(categoryOfApplication("PH")).toBeNull();
    expect(categoryOfApplication("")).toBeNull();
  });
});


describe("GOIReservationCard: horizontal reservations (GAP-RECRUITMENT-DETAIL-03)", () => {
  it("shows the sanctioned horizontal counts (PwBD, ex-servicemen) next to the vertical roster", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "approved", totalVacancies: 20, categoryVacancies: { UR: 20 }, horizontalVacancies: { PWBD: 1, EXSM: 2 } }), { status: 200 })));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    expect(await screen.findByText(/Horizontal: PwBD 1 · Ex-servicemen 2/)).toBeInTheDocument();
  });

  it("sends the horizontal counts with the roster and blocks a count above the total posts", async () => {
    let put: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") { put = JSON.parse(String(init.body)); return new Response("{}", { status: 200 }); }
      return new Response("{}", { status: 404 });
    }));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    fireEvent.click(await screen.findByRole("button", { name: /set roster/i }));
    for (const [cat, n] of Object.entries({ UR: "10", SC: "3", ST: "2", OBC: "4", EWS: "1" })) fireEvent.change(screen.getByLabelText(`${cat} posts`), { target: { value: n } });
    const save = screen.getByRole("button", { name: /save draft roster/i });
    fireEvent.change(screen.getByLabelText("PwBD"), { target: { value: "21" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("PwBD"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Ex-servicemen"), { target: { value: "2" } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(put).toBeTruthy());
    expect(put).toEqual({ totalVacancies: 20, categoryVacancies: { UR: 10, SC: 3, ST: 2, OBC: 4, EWS: 1 }, horizontalVacancies: { PWBD: 1, EXSM: 2 } });
  });
});

describe("GOIReservationCard: reservation shortlist (GAP-RECRUITMENT-DETAIL-03)", () => {
  const CANDS = [
    { id: "a1", label: "Asha Verma", category: "SC" },
    { id: "a2", label: "Rahul Singh", category: "General" },
    { id: "a3", label: "Dev Patel", category: "PH" },
  ];
  const APPROVED = { status: "approved", totalVacancies: 2, categoryVacancies: { UR: 1, SC: 1 } };

  function stub(shortlist: (init: RequestInit) => Response) {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/reservation-shortlist")) return shortlist(init as RequestInit);
      return new Response(JSON.stringify(APPROVED), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  async function openPanel(cands = CANDS) {
    renderCard({ totalVacancies: 2, candidates: cands });
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    return await screen.findByRole("region", { name: /reservation shortlist/i });
  }

  it("is offered only for an approved roster", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...APPROVED, status: "draft" }), { status: 200 })));
    renderCard({ totalVacancies: 2, candidates: CANDS });
    fireEvent.click(screen.getByRole("button", { name: /reservation status/i }));
    await screen.findByText("Draft");
    expect(screen.queryByRole("region", { name: /reservation shortlist/i })).not.toBeInTheDocument();
  });

  it("flags an unrecognised category and refuses to compute (fail closed, never UR)", async () => {
    const fn = stub(() => new Response("{}", { status: 200 }));
    const panel = await openPanel();
    expect(within(panel).getByText(/unrecognised category “PH”/i)).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText(/merit score for asha verma/i), { target: { value: "80" } });
    fireEvent.change(within(panel).getByLabelText(/merit score for rahul singh/i), { target: { value: "90" } });
    fireEvent.change(within(panel).getByLabelText(/merit score for dev patel/i), { target: { value: "70" } });
    fireEvent.click(within(panel).getByRole("button", { name: /compute shortlist/i }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/recognised category and a numeric merit score/i);
    expect(fn.mock.calls.some(([u]) => String(u).endsWith("/reservation-shortlist"))).toBe(false);
  });

  it("posts normalised categories and numeric scores, then lists selected and waitlisted candidates", async () => {
    let body: { candidates: unknown[] } | undefined;
    stub((init) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ mode: "category", selected: [{ applicationId: "a2", category: "UR", allocatedAgainst: "UR", rank: 1 }, { applicationId: "a1", category: "SC", allocatedAgainst: "SC", rank: 1 }], waitlist: [], filled: { UR: 1, SC: 1 } }), { status: 200 });
    });
    const panel = await openPanel(CANDS.slice(0, 2));
    fireEvent.change(within(panel).getByLabelText(/merit score for asha verma/i), { target: { value: "80.5" } });
    fireEvent.change(within(panel).getByLabelText(/merit score for rahul singh/i), { target: { value: "90" } });
    fireEvent.click(within(panel).getByRole("button", { name: /compute shortlist/i }));
    expect(await within(panel).findByText("Selected (2)")).toBeInTheDocument();
    expect(body).toEqual({ candidates: [{ applicationId: "a1", category: "SC", score: 80.5 }, { applicationId: "a2", category: "UR", score: 90 }] });
    expect(within(panel).getByText(/this result is not saved/i)).toBeInTheDocument();
  });

  it("explains a roster that is not approved (409) in plain words", async () => {
    stub(() => new Response(JSON.stringify({ code: "ROSTER_NOT_APPROVED" }), { status: 409 }));
    const panel = await openPanel(CANDS.slice(0, 1));
    fireEvent.change(within(panel).getByLabelText(/merit score for asha verma/i), { target: { value: "80" } });
    fireEvent.click(within(panel).getByRole("button", { name: /compute shortlist/i }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/roster must be approved/i);
  });
});
