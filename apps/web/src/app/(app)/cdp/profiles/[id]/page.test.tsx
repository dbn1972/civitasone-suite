import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../_data", () => ({
  getCdpProfile: vi.fn(),
  getCdpProfileIdentity: vi.fn(),
  getCdpProfileTimeline: vi.fn(),
}));

import Page from "./page";
import { getCdpProfile, getCdpProfileIdentity, getCdpProfileTimeline } from "../../_data";

const mProfile = vi.mocked(getCdpProfile);
const mIdentity = vi.mocked(getCdpProfileIdentity);
const mTimeline = vi.mocked(getCdpProfileTimeline);

const PROFILE_ID = "abcdef12-0000-4000-8000-00000000a3f9";

function baseProfile(over: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    profileType: "individual",
    attributes: {},
    sourceLineage: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    version: 1,
    mergedFromIds: [],
    ...over,
  };
}

beforeEach(() => {
  mProfile.mockReset();
  mIdentity.mockReset();
  mTimeline.mockReset();
  mIdentity.mockResolvedValue({ data: [], source: "api" } as never);
  mTimeline.mockResolvedValue({ data: [], source: "api" } as never);
});

async function renderPage() {
  render(await Page({ params: { id: PROFILE_ID } }));
}

describe("Customer 360 detail page", () => {
  // GAP-CDP-PROFILES-DETAIL-02: the full UUID must not appear in visible text.
  it("does not print the full profile UUID in the subtitle", async () => {
    mProfile.mockResolvedValue({ data: baseProfile(), source: "api" } as never);
    await renderPage();
    expect(screen.queryByText(new RegExp(PROFILE_ID))).not.toBeInTheDocument();
    expect(screen.getByText(/individual · ref …0000a3f9/)).toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-DETAIL-01: email/phone attributes must render masked.
  it("masks a PII attribute value in the attributes table", async () => {
    mProfile.mockResolvedValue({
      data: baseProfile({
        attributes: { email: "asha@example.gov.in", tier: "gold" },
        sourceLineage: [{ source: "crm", sourceId: "c1", timestamp: "2026-01-01T00:00:00.000Z", attributes: ["email"] }],
      }),
      source: "api",
    } as never);
    await renderPage();
    expect(screen.queryByText("asha@example.gov.in")).not.toBeInTheDocument();
    expect(screen.getByText(/a\*+@/)).toBeInTheDocument();
    // non-sensitive attribute still shown in full
    expect(screen.getByText("gold")).toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-DETAIL-03: a profile load error is not "Profile not found".
  it("shows a retryable error (not 'Profile not found') when the profile load fails", async () => {
    mProfile.mockResolvedValue({ data: null, source: "error" } as never);
    await renderPage();
    expect(screen.queryByText("Profile not found")).not.toBeInTheDocument();
  });

  it("shows 'Profile not found' only for a genuine null-with-success", async () => {
    mProfile.mockResolvedValue({ data: null, source: "api" } as never);
    await renderPage();
    expect(screen.getByText("Profile not found")).toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-DETAIL-03: a failed timeline load must not read "No events yet".
  it("shows an error in Recent Events (not 'No events yet') when the timeline load fails", async () => {
    mProfile.mockResolvedValue({ data: baseProfile(), source: "api" } as never);
    mTimeline.mockResolvedValue({ data: [], source: "error" } as never);
    await renderPage();
    expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-DETAIL-04: coverage reads "—" (not "0%") with no attributes.
  it("shows '—' for Attribution Coverage when the profile has no attributes", async () => {
    mProfile.mockResolvedValue({ data: baseProfile({ attributes: {} }), source: "api" } as never);
    await renderPage();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});
