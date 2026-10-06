import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_data", () => ({ getCdpProfileList: vi.fn() }));

import Page from "./page";
import { getCdpProfileList } from "../_data";

const mocked = vi.mocked(getCdpProfileList);

function profile(over: Record<string, unknown>) {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    profileType: "individual",
    attributes: {},
    sourceLineage: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    mergedFromIds: [],
    ...over,
  };
}

beforeEach(() => mocked.mockReset());

function ok(profiles: unknown[], total?: number) {
  return { data: { profiles, total: total ?? profiles.length, limit: 200 }, source: "api" } as never;
}

describe("CDP profiles list page", () => {
  it("renders the title 'CDP — Profiles'", async () => {
    mocked.mockResolvedValue(ok([]));
    render(await Page());
    expect(screen.getByRole("heading", { name: "CDP — Profiles" })).toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-01: a profile identified only by email/phone must render a
  // DPDP-masked label, never the full identifier.
  it("masks an email-only profile label (never shows the full address)", async () => {
    mocked.mockResolvedValue(ok([profile({ attributes: { email: "asha@example.gov.in" } })]));
    render(await Page());
    expect(screen.queryByText("asha@example.gov.in")).not.toBeInTheDocument();
    expect(screen.getByText(/a\*+@/)).toBeInTheDocument();
  });

  it("masks a phone-only profile label", async () => {
    mocked.mockResolvedValue(ok([profile({ attributes: { phone: "9876543210" } })]));
    render(await Page());
    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
    expect(screen.getByText(/98X+210/)).toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-03: a profile with no name/email/phone must show a short,
  // typed reference, never a 36-char UUID.
  it("shows a short typed reference, not a raw UUID, for an unnamed profile", async () => {
    mocked.mockResolvedValue(ok([profile({ id: "abcdef12-0000-4000-8000-00000000a3f9", attributes: {} })]));
    render(await Page());
    expect(screen.queryByText("abcdef12-0000-4000-8000-00000000a3f9")).not.toBeInTheDocument();
    expect(screen.getByText(/individual · …00a3f9/)).toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-02: on a load failure, stats read "—" (not "0") and the
  // table card is replaced by a refresh error — never "No profiles yet".
  it("shows '—' stats and a refresh error (not '0'/'No profiles yet') when the load fails", async () => {
    mocked.mockResolvedValue({ data: { profiles: [], total: 0, limit: 200 }, source: "error" } as never);
    render(await Page());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("No profiles yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/most recently resolved profiles/)).not.toBeInTheDocument();
  });

  it("shows 'No profiles yet' for a genuinely empty but healthy list", async () => {
    mocked.mockResolvedValue(ok([]));
    render(await Page());
    expect(screen.getByText("No profiles yet")).toBeInTheDocument();
  });

  // GAP-CDP-PROFILES-04: with a server total greater than the loaded page, the
  // Total Profiles tile shows the real total and the footnote says it is capped.
  it("shows the real total and a 'capped' footnote when meta.total exceeds the loaded page", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => profile({ id: `id-${i}`, attributes: { name: `P${i}` } }));
    mocked.mockResolvedValue(ok(rows, 4210));
    render(await Page());
    expect(screen.getByText("4,210")).toBeInTheDocument();
    expect(screen.getByText(/Showing the latest 3 of 4,210 profiles \(capped at 200\)/)).toBeInTheDocument();
  });
});
