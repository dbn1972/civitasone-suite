import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnboardingTable } from "./OnboardingTable";
import { onboardingStageTone, onboardingStats, toOnboardingRows } from "./onboardingStats";
import { useSeededResource } from "@/lib/sync/resource";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

const q = (stage: string, org = stage) => ({ org, contact: "a@b.gov.in", requested: "2026-09-01", assigned: "x", stage });
function seeded(data: Record<string, unknown>[], provenance: "live" | "cached" | "error-no-data") {
  vi.mocked(useSeededResource).mockReturnValue({ data, fromCache: provenance === "cached", offline: false, cachedAt: null, provenance } as never);
}

describe("onboardingStats (GAP-ADMIN-ONBOARDING-04)", () => {
  it("In Queue excludes completed rows", () => {
    expect(onboardingStats(toOnboardingRows([q("new request"), q("completed", "c1"), q("completed", "c2")])).inQueue).toBe(1);
  });
  it("a blocked stage is not counted In Progress; it is surfaced as Other", () => {
    const s = onboardingStats(toOnboardingRows([q("blocked"), q("in progress"), q("go-live pending"), q("new request")]));
    expect(s).toMatchObject({ inQueue: 4, inProgress: 1, ready: 1, newReqs: 1, other: 1 });
  });
  it("tones the stages the page uses (GAP-ADMIN-ONBOARDING-06)", () => {
    expect(onboardingStageTone("go-live pending")).toBe("warn");
    expect(onboardingStageTone("completed")).toBe("good");
  });
});

describe("OnboardingTable (GAP-ADMIN-ONBOARDING-02/-03)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cached rows with empty server list: New Requests equals the table's new-request rows", () => {
    seeded([q("new request", "o1"), q("new request", "o2"), q("completed", "o3")], "cached");
    render(<OnboardingTable queue={[]} />);
    expect(screen.getByText("New Requests").parentElement).toHaveTextContent("2");
    expect(screen.getByText("In Queue").parentElement).toHaveTextContent("2");
  });

  it("failure with no cache: dashes + retry, not the empty-queue message", () => {
    seeded([], "error-no-data");
    render(<OnboardingTable queue={[]} source="error" errorStatus={500} />);
    expect(screen.getByText("New Requests").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No requests")).not.toBeInTheDocument();
  });

  it("403 is access restricted", () => {
    seeded([], "error-no-data");
    render(<OnboardingTable queue={[]} source="error" errorStatus={403} />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
