import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Customer360Panel } from "./Customer360Panel";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getContact360: vi.fn(), getAccount360: vi.fn() };
});

const empty = aa.normalise360(null);

beforeEach(() => {
  vi.mocked(aa.getContact360).mockReset();
  vi.mocked(aa.getAccount360).mockReset();
});

describe("Customer360Panel (CM-004)", () => {
  it("gates every stat on error → shows dashes + saved-info badge, never a 0", async () => {
    vi.mocked(aa.getContact360).mockResolvedValue({ data: empty, source: "error" });
    render(<Customer360Panel subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/showing saved information/i)[0]).toBeInTheDocument());
    // Stat values render "—" not "0" on error
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the external cases/documents as a link-across stub, not a fabricated 0", async () => {
    vi.mocked(aa.getContact360).mockResolvedValue({
      // Real backend NESTED external shape; unsynced ⇒ null counts.
      data: aa.normalise360({
        score: 3,
        external: {
          helpdeskCases: { count: null, source: "external" },
          knowledgeDocuments: { count: null, source: "external" },
        },
      }),
      source: "api",
    });
    render(<Customer360Panel subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/cases & documents/i)).toBeInTheDocument());
    expect(screen.getByText(/External · not synced/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view in helpdesk/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view in knowledge/i })).toBeInTheDocument();
    // external counts show "—", never "0"
    const cases = screen.getByText(/Cases \(Helpdesk\)/i).parentElement!;
    expect(cases.textContent).toContain("—");
    expect(cases.textContent).not.toContain("0");
  });

  it("renders a NON-null nested external count once helpdesk/knowledge go live", async () => {
    vi.mocked(aa.getContact360).mockResolvedValue({
      data: aa.normalise360({
        external: {
          helpdeskCases: { count: 4, source: "helpdesk" },
          knowledgeDocuments: { count: 7, source: "knowledge" },
        },
      }),
      source: "api",
    });
    render(<Customer360Panel subjectType="contact" subjectId="c1" />);
    const cases = (await screen.findByText(/Cases \(Helpdesk\)/i)).parentElement!;
    expect(cases.textContent).toContain("4");
    const docs = screen.getByText(/Documents \(Knowledge\)/i).parentElement!;
    expect(docs.textContent).toContain("7");
  });

  it("renders aggregated data on a healthy load and calls the account loader for accounts", async () => {
    vi.mocked(aa.getAccount360).mockResolvedValue({
      data: aa.normalise360({
        activities: [{ id: "a1", createdAt: "2026-01-01T00:00:00Z" }],
        deals: [{ id: "d1", name: "Big Deal", stage: "won", amount: 100 }],
        roles: [{ id: "r1", role: "beneficiary", dealId: "d1" }],
        addresses: [{ id: "ad1", addressType: "office", line1: "1 Rd", city: "Pune", pincode: "411001" }],
        consent: { marketing: true },
        score: 88,
        external: { caseCount: null, documentCount: null, source: "external" },
      }),
      source: "api",
    });
    render(<Customer360Panel subjectType="account" subjectId="a1" />);
    expect(await screen.findByText("Big Deal")).toBeInTheDocument();
    expect(screen.getByText("Beneficiary")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText(/marketing consent given/i)).toBeInTheDocument();
    expect(aa.getAccount360).toHaveBeenCalledWith("a1");
    expect(aa.getContact360).not.toHaveBeenCalled();
  });

  it("renders the REAL §9.4 communication + campaign blocks with a synced marker", async () => {
    vi.mocked(aa.getContact360).mockResolvedValue({
      data: aa.normalise360({
        communicationItems: { items: [{ id: "m1" }, { id: "m2" }], total: 2 },
        communications: { total: 12, delivered: 10, failed: 2, source: "crm" },
        campaignActivity: { responses: 5, conversions: 2, revenueMinor: "1234567", source: "crm" },
        external: { caseCount: null, documentCount: null, source: "external" },
      }),
      source: "api",
    });
    render(<Customer360Panel subjectType="contact" subjectId="c1" />);
    const section = await screen.findByRole("region", { name: /communication and campaign activity/i });
    // Marked as real / synced (distinct from the external stub).
    expect(within(section).getByText(/In CRM · synced/i)).toBeInTheDocument();
    // Communication counts.
    expect(within(section).getByText("12")).toBeInTheDocument(); // total
    expect(within(section).getByText("10")).toBeInTheDocument(); // delivered
    // Campaign counts + paise→₹ via money.ts (no float).
    expect(within(section).getByText("5")).toBeInTheDocument(); // responses
    expect(within(section).getByText("₹12,345.67")).toBeInTheDocument();
    // The renamed contact item list (communicationItems) drives the top stat total.
    const commStat = screen.getByText("Communications").closest(".stat")!;
    expect(within(commStat as HTMLElement).getByText("12")).toBeInTheDocument();
  });

  it("shows a REAL zero (source:'crm') as 0 — not a dash or stub", async () => {
    vi.mocked(aa.getContact360).mockResolvedValue({
      data: aa.normalise360({
        communications: { total: 0, delivered: 0, failed: 0, source: "crm" },
        campaignActivity: { responses: 0, conversions: 0, revenueMinor: "0", source: "crm" },
        external: { caseCount: null, documentCount: null, source: "external" },
      }),
      source: "api",
    });
    render(<Customer360Panel subjectType="contact" subjectId="c1" />);
    const section = await screen.findByRole("region", { name: /communication and campaign activity/i });
    // Real zeros render "0", and the block is NOT the saved-info error state.
    expect(within(section).getAllByText("0").length).toBeGreaterThan(0);
    expect(within(section).queryByText(/showing saved information/i)).not.toBeInTheDocument();
    expect(within(section).getByText("₹0.00")).toBeInTheDocument();
    // The still-external stub remains a "—" link-across, never fabricated.
    const cases = screen.getByText(/Cases \(Helpdesk\)/i).parentElement!;
    expect(cases.textContent).toContain("—");
  });

  it("on error the §9.4 blocks show the saved-info badge, never fabricated counts", async () => {
    vi.mocked(aa.getContact360).mockResolvedValue({ data: empty, source: "error" });
    render(<Customer360Panel subjectType="contact" subjectId="c1" />);
    const section = await screen.findByRole("region", { name: /communication and campaign activity/i });
    expect(within(section).getByText(/showing saved information/i)).toBeInTheDocument();
    // No fabricated zero and no synced marker in the error state.
    expect(within(section).queryByText("0")).not.toBeInTheDocument();
    expect(within(section).queryByText(/In CRM · synced/i)).not.toBeInTheDocument();
  });

  it("account 360: renamed localCommunications still feeds the item count", async () => {
    vi.mocked(aa.getAccount360).mockResolvedValue({
      data: aa.normalise360({
        localCommunications: [{ id: "lc1" }, { id: "lc2" }, { id: "lc3" }],
        communications: { total: 3, delivered: 3, failed: 0, source: "crm" },
        campaignActivity: { responses: 0, conversions: 0, revenueMinor: "0", source: "crm" },
        external: { caseCount: null, documentCount: null, source: "external" },
      }),
      source: "api",
    });
    render(<Customer360Panel subjectType="account" subjectId="a1" />);
    const commStat = (await screen.findByText("Communications")).closest(".stat")!;
    expect(within(commStat as HTMLElement).getByText("3")).toBeInTheDocument();
  });
});
