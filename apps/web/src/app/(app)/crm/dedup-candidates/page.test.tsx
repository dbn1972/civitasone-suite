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

// The viewer's roles drive whether the audited Reveal control is offered
// (GAP-CRM-DEDUP-CANDIDATES-01). Default: no roles loaded -> masked text only.
const identity = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@/lib/auth/useSessionIdentity", () => ({
  useSessionIdentity: () => ({ loaded: true, userId: "u1", roles: identity.roles }),
}));

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
  identity.roles = [];
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

    // Confidence badge aria-labels (GAP-CRM-DEDUP-CANDIDATES-06: now carry a
    // non-colour "High/Medium/Low match" cue alongside the percentage)
    expect(screen.getByLabelText("High match, confidence 85%")).toBeInTheDocument();
    expect(screen.getByLabelText("Medium match, confidence 65%")).toBeInTheDocument();
    expect(screen.getByLabelText("Low match, confidence 45%")).toBeInTheDocument();

    // Contact names appear
    expect(screen.getAllByText("Priya Sharma").length).toBeGreaterThanOrEqual(2);
  });

  it("GAP-CRM-DEDUP-CANDIDATES-06: a high match reads as a strong 'High match' (emphasis), not a danger alarm", async () => {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({
      data: [{ ...PAIR, confidence: 92 }],
      source: "api",
    });
    render(<DedupCandidatesPage />);

    await waitFor(() => expect(screen.getByText("92%")).toBeInTheDocument());
    // non-colour text cue present
    expect(screen.getByText("High match")).toBeInTheDocument();
    // the badge carries the emphasis class, not a danger/low-match one
    const badge = screen.getByText("92%").closest(".conf-badge");
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains("conf-high")).toBe(true);
    expect(badge?.classList.contains("conf-low")).toBe(false);
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

  it("GAP-CRM-DEDUP-CANDIDATES-04: renders at most PAGE_SIZE=15 pairs per page and shows pagination controls", async () => {
    // Create 20 pairs with varied confidence levels
    const pairs = Array.from({ length: 20 }, (_, i) => ({
      pairId: `p${i}`,
      left: { name: `Left ${i}`, email: `left${i}@example.com`, phone: "9876543210", company: "Org" },
      right: { name: `Right ${i}`, email: `right${i}@example.com`, phone: "9876543210", company: "Org" },
      confidence: 0.9 - i * 0.01,
      matchReasons: [],
    }));
    vi.mocked(api.getDedupCandidates).mockResolvedValueOnce({ data: pairs, source: "api" } as never);
    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.queryAllByText("Left 0").length).toBeGreaterThan(0));
    // Page 1: first 15 pairs visible
    expect(screen.queryAllByText("Left 0").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Left 14").length).toBeGreaterThan(0);
    // Pair 15 is NOT on page 1
    expect(screen.queryAllByText("Left 15").length).toBe(0);
    // Pagination controls show "Page 1 of 2"
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
  });

});

// GAP-CRM-DEDUP-CANDIDATES-01: crm-service now masks email/phone before they leave
// the server, and the clear value is reachable only through the audited reveal.
const MASKED_LEFT = { ...LEFT, email: "p***@example.com", phone: "*******3210" };
const MASKED_RIGHT = { ...RIGHT, email: "p***@example.com", phone: "*******3211" };
const MASKED_PAIR = {
  pairId: "pair-masked",
  confidence: 85,
  left: MASKED_LEFT,
  right: MASKED_RIGHT,
  matchedFields: ["name", "company"],
  diffFields: ["phone", "lastActivity"],
};

describe("DedupCandidatesPage PII reveal (GAP-CRM-DEDUP-CANDIDATES-01)", () => {
  async function renderPage(pair: typeof MASKED_PAIR | typeof PAIR = MASKED_PAIR) {
    vi.mocked(api.getDedupCandidates).mockResolvedValue({ data: [pair as never], source: "api" });
    render(<DedupCandidatesPage />);
    await waitFor(() => expect(screen.getByText("85%")).toBeInTheDocument());
  }

  it("shows server-masked email/phone as received, with no Reveal button for a plain crm_user", async () => {
    identity.roles = ["crm_user"];
    await renderPage();
    expect(screen.getAllByText("p***@example.com").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("*******3210")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  it("offers no Reveal button while the viewer's roles are still unknown", async () => {
    identity.roles = [];
    await renderPage();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  it.each([["crm_admin"], ["super_admin"], ["tenant_admin"]])(
    "offers Reveal on all four email/phone cells to %s, and not on name/company/last activity",
    async (role) => {
      identity.roles = [role];
      await renderPage();
      expect(screen.getAllByRole("button", { name: "Reveal" })).toHaveLength(4);
    },
  );

  it("revealing calls the audited endpoint for that contact+field with the typed reason, then shows the clear value", async () => {
    identity.roles = ["crm_admin"];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { value: "priya@example.com" } }), { status: 200 }));
    await renderPage();
    expect(screen.queryByText("priya@example.com")).not.toBeInTheDocument();

    // First Reveal button = the kept (left) contact's email.
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for revealing/i), { target: { value: "Confirming the duplicate by email" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reveal" }));

    expect(await screen.findByText("priya@example.com")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/crm/pii/reveal");
    expect(JSON.parse(init.body as string)).toEqual({
      resourceType: "contact",
      resourceId: MASKED_LEFT.id,
      field: "email",
      reason: "Confirming the duplicate by email",
    });
  });

  it("never reveals without a reason of at least 10 characters (no request is made)", async () => {
    identity.roles = ["crm_admin"];
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for revealing/i), { target: { value: "too short" } });
    expect(within(dialog).getByRole("button", { name: "Reveal" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("highlights the fields the SERVER says differ, even when the masked text is identical", async () => {
    identity.roles = ["crm_user"];
    await renderPage();
    const rows = Array.from(document.querySelectorAll(".dedup-grid-row")).filter((r) => r.getAttribute("role") === "row");
    const byLabel = (label: string) => rows.find((r) => r.querySelector('[role="rowheader"]')?.textContent === label);
    // phone masks to different strings AND is in diffFields; email masks identically and is not.
    expect(byLabel("Phone")?.querySelectorAll(".dedup-diff").length).toBe(2);
    expect(byLabel("Email")?.querySelectorAll(".dedup-diff").length).toBe(0);
    expect(byLabel("Last activity")?.querySelectorAll(".dedup-diff").length).toBe(2);
  });

  it("highlights a phone that differs on the clear values even if both mask the same (server diffFields wins)", async () => {
    identity.roles = ["crm_user"];
    const sameMask = {
      ...MASKED_PAIR,
      left: { ...MASKED_LEFT, phone: "*******3210" },
      right: { ...MASKED_RIGHT, phone: "*******3210" },
      diffFields: ["phone"],
    };
    await renderPage(sameMask);
    const rows = Array.from(document.querySelectorAll(".dedup-grid-row")).filter((r) => r.getAttribute("role") === "row");
    const phoneRow = rows.find((r) => r.querySelector('[role="rowheader"]')?.textContent === "Phone");
    expect(phoneRow?.querySelectorAll(".dedup-diff").length).toBe(2);
  });

  it("lists the match reasons from the server", async () => {
    identity.roles = ["crm_user"];
    await renderPage();
    expect(screen.getByText("Matched on: Name, Company")).toBeInTheDocument();
  });

  it("still masks a clear email/phone from a server that has not been upgraded", async () => {
    identity.roles = ["crm_user"];
    await renderPage(PAIR);
    expect(screen.queryByText("priya@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("+91-9876543210")).not.toBeInTheDocument();
  });
});
