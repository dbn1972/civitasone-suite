import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: refreshMock }),
}));

import { ArchiveTemplateButton } from "./JdTemplateActions";

const ID = "7d3f1c52-9b0e-4a64-8f21-6c5d4e3b2a10";
const fetchMock = vi.fn();

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ArchiveTemplateButton id={ID} name="Junior Analyst" />
    </NextIntlClientProvider>,
  );
}

// Fake timers are on in these tests, so nothing here may use findBy*/waitFor (they poll on timers).
async function openDialog(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  });
  return screen.getByRole("alertdialog");
}

async function openAndConfirm() {
  const dialog = await openDialog();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
  });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ArchiveTemplateButton (GAP-HR-JD-TEMPLATES-04)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks for confirmation first and sends nothing until it is given", async () => {
    renderButton();
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("Archive this template?");
    expect(dialog).toHaveTextContent("Junior Analyst");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation sends nothing", async () => {
    renderButton();
    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does NOT refresh the list straight after the 202: it says the request was received, then polls until the template reports isArchived", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return json({ id: ID, status: "accepted" }, 202);
      // GET /:id -- not archived on the first look, archived on the second
      const gets = fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method !== "DELETE").length;
      return json({ id: ID, isArchived: gets >= 2 });
    });
    renderButton();
    await openAndConfirm();

    expect(fetchMock).toHaveBeenCalledWith(`/api/proxy/v1/hrms/jd-templates/${ID}`, { method: "DELETE" });
    // accepted, not yet done -- the card must not be claimed gone, and the list must not have been re-read yet
    expect(screen.getByText(/Archive request received for "Junior Analyst"/)).toBeInTheDocument();
    expect(screen.queryByText(/Done\./)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(700); });   // 1st poll: still listed
    expect(refreshMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });  // 2nd poll: archived
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Done\./)).toBeInTheDocument();
  });

  it("gives up politely if the archive never shows: 'Still processing' with a manual refresh, no fake success", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return json({ id: ID, status: "accepted" }, 202);
      return json({ id: ID, isArchived: false });
    });
    renderButton();
    await openAndConfirm();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });

    expect(screen.getByText(/Still processing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeInTheDocument();
    expect(screen.queryByText(/Done\./)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("a failed archive shows fixed, translated copy (never the server's raw message) and changes nothing", async () => {
    fetchMock.mockResolvedValue(json({ code: "INTERNAL", message: "pg: connection reset by peer" }, 500));
    renderButton();
    await openAndConfirm();

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Couldn't archive this template. Please try again.");
    expect(dialog.textContent).not.toMatch(/connection reset/);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
