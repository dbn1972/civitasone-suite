/**
 * DQ-005 — Dedup Candidates page tests.
 *
 * Covers:
 *  1. Renders pair list with confidence score badges
 *  2. Merge button opens a confirm dialog with contact names
 *  3. Dismiss action removes the pair from the list
 *  4. Empty state renders when the API returns no pairs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DedupCandidatesPage, { type DedupPair } from "./page";

// ─── Mock browserFetch ────────────────────────────────────────────────────────

vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: vi.fn(),
  errorMessageFromResponse: async () => "Request failed",
}));

import { browserFetch } from "@/lib/api/browserClient";
const mockFetch = vi.mocked(browserFetch);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PAIR_HIGH: DedupPair = {
  pairId: "pair-1",
  confidence: 85,
  matchedFields: ["email"],
  left: {
    id: "c-001",
    name: "Asha Gupta",
    email: "asha@example.in",
    phone: "9900001111",
    company: "Acme Ltd",
    lastActivity: "2026-07-01",
  },
  right: {
    id: "c-002",
    name: "Asha R. Gupta",
    email: "asha@example.in",
    phone: "9900002222",
    company: "Acme Limited",
    lastActivity: "2026-06-28",
  },
};

const PAIR_AMBER: DedupPair = {
  pairId: "pair-2",
  confidence: 65,
  matchedFields: ["phone"],
  left: {
    id: "c-003",
    name: "Ravi Kumar",
    email: null,
    phone: "8800001111",
    company: null,
    lastActivity: null,
  },
  right: {
    id: "c-004",
    name: "Ravi K.",
    email: "ravi@mail.in",
    phone: "8800001111",
    company: null,
    lastActivity: null,
  },
};

function makeOkResponse(pairs: DedupPair[]) {
  return {
    ok: true,
    json: async () => ({ data: pairs }),
  } as unknown as Response;
}

function makeOkEmpty() {
  return {
    ok: true,
    json: async () => ({ data: [] }),
  } as unknown as Response;
}

function makeActionOk() {
  return { ok: true, json: async () => ({}) } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DedupCandidatesPage", () => {
  it("renders pair list with confidence score badges", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([PAIR_HIGH, PAIR_AMBER]));

    render(<DedupCandidatesPage />);

    // Loading state appears first
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Pair cards appear after data loads
    expect(await screen.findByLabelText("Confidence score 85%")).toBeInTheDocument();
    expect(await screen.findByLabelText("Confidence score 65%")).toBeInTheDocument();

    // Badge text
    expect(screen.getByText("85% match")).toBeInTheDocument();
    expect(screen.getByText("65% match")).toBeInTheDocument();

    // Contact names appear in table headers
    expect(screen.getByText(/Left — Asha Gupta/)).toBeInTheDocument();
    expect(screen.getByText(/Right — Asha R\. Gupta/)).toBeInTheDocument();

    // Count summary
    expect(screen.getByText(/2 pairs flagged/i)).toBeInTheDocument();
  });

  it("diff-highlights fields that differ between the two contacts", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([PAIR_HIGH]));

    render(<DedupCandidatesPage />);
    await screen.findByText("85% match");

    // Phone differs (9900001111 vs 9900002222) — right cell should carry aria-label
    const diffCells = screen
      .getAllByRole("cell")
      .filter((el) => el.getAttribute("aria-label") === "Phone differs");

    expect(diffCells.length).toBeGreaterThanOrEqual(1);
  });

  it("merge button opens confirm dialog with correct contact names", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([PAIR_HIGH]));

    render(<DedupCandidatesPage />);
    await screen.findByText("85% match");

    // Click the Merge button for the first pair
    fireEvent.click(screen.getByRole("button", { name: /merge asha r\. gupta into asha gupta/i }));

    // ConfirmDialog must appear with the contact names in the body
    expect(await screen.findByText(/permanently merge/i)).toBeInTheDocument();
    expect(screen.getByText("Asha R. Gupta")).toBeInTheDocument();
    expect(screen.getByText("Asha Gupta")).toBeInTheDocument();

    // "Merge permanently" confirm button must be present
    expect(screen.getByRole("button", { name: /merge permanently/i })).toBeInTheDocument();
  });

  it("confirming merge calls PATCH and removes the pair", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse([PAIR_HIGH]))  // initial load
      .mockResolvedValueOnce(makeActionOk());              // PATCH merge

    render(<DedupCandidatesPage />);
    await screen.findByText("85% match");

    // Open dialog
    fireEvent.click(screen.getByRole("button", { name: /merge asha r\. gupta into asha gupta/i }));
    await screen.findByRole("button", { name: /merge permanently/i });

    // Confirm
    fireEvent.click(screen.getByRole("button", { name: /merge permanently/i }));

    // Pair card disappears; fetch called with correct path + body
    await waitFor(() => {
      expect(screen.queryByText("85% match")).not.toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "v1/crm/contacts/c-001/merge",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ mergeIntoId: "c-002" }),
      }),
    );
  });

  it("dismiss action removes the pair from the list", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse([PAIR_HIGH, PAIR_AMBER]))  // initial load
      .mockResolvedValueOnce(makeActionOk());                           // PATCH dismiss

    render(<DedupCandidatesPage />);
    await screen.findByText("85% match");

    // Dismiss the first pair
    const dismissButtons = screen.getAllByRole("button", { name: /dismiss pair/i });
    fireEvent.click(dismissButtons[0]!);

    // First pair disappears; second pair remains
    await waitFor(() => {
      expect(screen.queryByText("85% match")).not.toBeInTheDocument();
    });
    expect(screen.getByText("65% match")).toBeInTheDocument();

    expect(mockFetch).toHaveBeenCalledWith(
      "v1/crm/contacts/dedup-candidates/pair-1/dismiss",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("renders empty state when no pairs are returned", async () => {
    mockFetch.mockResolvedValueOnce(makeOkEmpty());

    render(<DedupCandidatesPage />);

    expect(
      await screen.findByText(/no duplicate candidates found/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/data is clean/i)).toBeInTheDocument();
  });

  it("cancel on confirm dialog keeps the pair visible", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([PAIR_HIGH]));

    render(<DedupCandidatesPage />);
    await screen.findByText("85% match");

    fireEvent.click(screen.getByRole("button", { name: /merge asha r\. gupta into asha gupta/i }));
    await screen.findByRole("button", { name: /merge permanently/i });

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    // Dialog closes, pair still visible
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /merge permanently/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText("85% match")).toBeInTheDocument();
  });
});
