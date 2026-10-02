import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    expect(put).toEqual({ totalVacancies: 20, categoryVacancies: { UR: 10, SC: 3, ST: 2, OBC: 4, EWS: 1 } });
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
