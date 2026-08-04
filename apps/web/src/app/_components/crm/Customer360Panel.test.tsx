import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
      data: aa.normalise360({ score: 3, external: { caseCount: null, documentCount: null, source: "external" } }),
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
});
