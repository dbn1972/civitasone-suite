import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}
import DedupCandidatesPage from "./page";
import * as api from "@/lib/crm/dedupCandidates";

vi.mock("@/lib/crm/dedupCandidates", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dedupCandidates")>();
  return {
    ...actual,
    getDedupCandidates: vi.fn(),
    mergeDedupPair: vi.fn(),
    dismissDedupPair: vi.fn(),
  };
});

// DataSourceBadge is a named import; mock it minimally so we can assert on it.
vi.mock("@/app/_components/DataSourceBadge", () => ({
  DataSourceBadge: ({ source }: { source: string }) => (
    <div data-testid="data-source-badge">{source}</div>
  ),
}));

const LEFT = {
  id: "aaa-111",
  name: "Priya Sharma",
  email: "priya@example.com",
  phone: "+91-9876543210",
  company: "Infosys",
  lastActivity: "2026-07-01T10:00:00Z",
};

const RIGHT = {
  id: "bbb-222",
  name: "Priya Sharma",
  email: "priya.s@example.com", // differs
  phone: "+91-9876543210",
  company: "Infosys",
  lastActivity: "2026-07-05T10:00:00Z", // differs
};

const PAIR = {
  pairId: "pair-001",
  confidence: 85,
  left: LEFT,
  right: RIGHT,
};

const PAIR_MID = { ...PAIR, pairId: "pair-002", confidence: 65 };
const PAIR_LOW = { ...PAIR, pairId: "pair-003", confidence: 45 };

beforeEach(() => {
  vi.mocked(api.getDedupCandidates).mockReset();
  vi.mocked(api.mergeDedupPair).mockReset();
  vi.mocked(api.dismissDedupPair).mockReset();
});

describe("DedupCandidatesPage", () => {
  it("renders pair list with confidence score badges", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [PAIR, PAIR_MID, PAIR_LOW],
      source: "api",
    });

    render(<DedupCandidatesPage />);

    // Wait for loading to resolve
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());
    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();

    // Confidence badge aria-labels
    expect(screen.getByLabelText("Confidence 85%")).toBeInTheDocument();
    expect(screen.getByLabelText("Confidence 65%")).toBeInTheDocument();
    expect(screen.getByLabelText("Confidence 45%")).toBeInTheDocument();

    // Contact names appear
    expect(screen.getAllByText("Priya Sharma").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the merge confirm dialog when Merge button is clicked", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [PAIR],
      source: "api",
    });
    vi.mocked(api.mergeDedupPair).mockResolvedValue(undefined);

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    // ConfirmDialog should not be visible initially
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    // Click the Merge button
    const mergeBtn = screen.getByRole("button", { name: /merge → keep/i });
    fireEvent.click(mergeBtn);

    // Dialog appears with correct warning text
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/permanently merge/i);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    // Right contact's name appears in description
    expect(dialog).toHaveTextContent("Priya Sharma");
  });

  it("calls mergeDedupPair and removes the pair on confirm", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [PAIR],
      source: "api",
    });
    vi.mocked(api.mergeDedupPair).mockResolvedValue(undefined);

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    // Open dialog
    fireEvent.click(screen.getByRole("button", { name: /merge → keep/i }));
    await screen.findByRole("alertdialog");

    // GAP-CRM-DEDUP-CANDIDATES-02: a reason (>=10 chars) is required to confirm
    const reason = screen.getByLabelText(/reason for merge/i);
    fireEvent.change(reason, { target: { value: "confirmed duplicate record" } });

    // Confirm merge
    const confirmBtn = screen.getByRole("button", { name: /^merge$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(api.mergeDedupPair).toHaveBeenCalledWith("aaa-111", "bbb-222", "confirmed duplicate record"),
    );

    // Dialog closed and pair removed from list
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("85%")).not.toBeInTheDocument();
  });

  it("GAP-CRM-DEDUP-CANDIDATES-02: Swap makes the right contact the primary in the POST body", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({ data: [PAIR], source: "api" });
    vi.mocked(api.mergeDedupPair).mockResolvedValue(undefined);

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    // Swap sides, then merge
    fireEvent.click(screen.getByRole("button", { name: /swap/i }));
    fireEvent.click(screen.getByRole("button", { name: /merge → keep/i }));
    await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText(/reason for merge/i), {
      target: { value: "right record is the better source" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^merge$/i }));

    // right (bbb-222) is now primary, left (aaa-111) is the duplicate
    await waitFor(() =>
      expect(api.mergeDedupPair).toHaveBeenCalledWith("bbb-222", "aaa-111", "right record is the better source"),
    );
  });

  it("GAP-CRM-DEDUP-CANDIDATES-03: Dismiss opens a confirm and calls no API until confirmed", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [PAIR],
      source: "api",
    });
    vi.mocked(api.dismissDedupPair).mockResolvedValue(undefined);

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /dismiss pair/i }));

    // confirmation dialog appears; no API call yet
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/will not surface again/i);
    expect(api.dismissDedupPair).not.toHaveBeenCalled();

    // confirm
    fireEvent.click(within(dialog).getByRole("button", { name: /^dismiss pair$/i }));
    await waitFor(() => expect(api.dismissDedupPair).toHaveBeenCalledWith("pair-001", undefined));
    await waitFor(() => expect(screen.queryByText("85%")).not.toBeInTheDocument());
  });

  it("GAP-CRM-DEDUP-CANDIDATES-03: cancelling the dismiss confirm leaves the pair", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({ data: [PAIR], source: "api" });

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /dismiss pair/i }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(api.dismissDedupPair).not.toHaveBeenCalled();
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("GAP-CRM-DEDUP-CANDIDATES-04: sorts pairs highest-confidence first and filters by confidence", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [PAIR_LOW, PAIR_MID, PAIR],
      source: "api",
    });

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    // highest confidence card renders first in DOM
    const badges = screen.getAllByText(/^\d+%$/).map((el) => el.textContent);
    expect(badges[0]).toBe("85%");

    // header shows the total
    expect(screen.getByText(/3 of 3 pairs/i)).toBeInTheDocument();

    // filter to 80%+ hides the 65% and 45% pairs
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "80" } });
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
    expect(screen.queryByText("45%")).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 3 pairs/i)).toBeInTheDocument();
  });

  it("renders the empty state when no pairs are returned", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [],
      source: "api",
    });

    render(<DedupCandidatesPage />);
    await waitFor(() =>
      expect(
        screen.getByText(/no duplicate candidates found/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/data is clean/i)).toBeInTheDocument();
  });

  it("shows DataSourceBadge on API error without fabricating empty state", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [],
      source: "error",
    });

    render(<DedupCandidatesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("data-source-badge")).toBeInTheDocument(),
    );
    // Empty state must NOT appear on error — it would imply "data is clean"
    expect(screen.queryByText(/no duplicate candidates found/i)).not.toBeInTheDocument();
  });

  it("highlights fields that differ between left and right contacts (amber class)", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [PAIR],
      source: "api",
    });

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    // Email differs — both cells should carry dedup-diff
    const diffCells = document.querySelectorAll(".dedup-diff");
    expect(diffCells.length).toBeGreaterThan(0);
  });

  it("masks email and phone by default and never shows the raw PII (GAP-CRM-DEDUP-CANDIDATES-01)", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [PAIR],
      source: "api",
    });

    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());

    // The full email/phone of either contact must not appear in the clear.
    expect(screen.queryByText("priya@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("priya.s@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("+91-9876543210")).not.toBeInTheDocument();
    // A masked form is shown instead (first char of local part + masked domain).
    expect(screen.getAllByText("p***@e******.c**").length).toBeGreaterThanOrEqual(1);
    // Name/company stay clear so the pair is still recognisable (minimisation,
    // not blanket hiding).
    expect(screen.getAllByText("Priya Sharma").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Infosys").length).toBeGreaterThanOrEqual(2);
  });
});
