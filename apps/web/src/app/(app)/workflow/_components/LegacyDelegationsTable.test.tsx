import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { LegacyDelegationsTable } from "./LegacyDelegationsTable";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const DELEGATE = "22222222-2222-4222-8222-222222222222";

/** Row exactly as GET /v1/workflow/delegations/legacy-report returns it (routes.ts: delegatorId is exposed as createdBy). */
const legacyRow = (over: Record<string, unknown> = {}) => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdBy: CREATOR, delegateId: DELEGATE,
  fromDate: "2026-02-01", toDate: null, reason: "Legacy cover", createdAt: "2026-02-01T09:00:00.000Z", ...over,
});
const body = (rows: unknown[], total = rows.length) => new Response(JSON.stringify({ data: rows, total }), { status: 200 });

function stub(report: () => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/identity/users/directory")) {
      return new Response(JSON.stringify({ data: [{ id: CREATOR, displayName: "Meera Iyer" }, { id: DELEGATE, displayName: "Asha Rao" }] }), { status: 200 });
    }
    return report();
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("LegacyDelegationsTable", () => {
  it("requests the legacy report endpoint", async () => {
    const spy = stub(() => body([legacyRow()]));
    render(<LegacyDelegationsTable />);
    await screen.findByText("Legacy cover");
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/workflow/delegations/legacy-report?limit=200");
  });

  it("lists rows with the creator and delegate named, and an explicit open-ended marker", async () => {
    stub(() => body([legacyRow()]));
    render(<LegacyDelegationsTable />);
    expect(await screen.findByText("Legacy cover")).toBeInTheDocument();
    expect(await screen.findByText("Meera Iyer")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("No end date")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Created by/ })).toBeInTheDocument();
    expect(screen.getByText(/needs its creator to issue a new delegation/)).toBeInTheDocument();
  });

  it("falls back to a short id when the directory cannot name a person", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("/identity/users/directory") ? new Response("no", { status: 500 }) : body([legacyRow()]));
    render(<LegacyDelegationsTable />);
    expect((await screen.findAllByText("Unknown person (11111111)")).length).toBeGreaterThan(0);
  });

  it("shows loading, then empty, as different states", async () => {
    stub(() => new Promise<Response>(() => {}));
    const { unmount } = render(<LegacyDelegationsTable />);
    expect(await screen.findByText("Loading legacy delegations…")).toBeInTheDocument();
    expect(screen.queryByText("No legacy delegations")).not.toBeInTheDocument();
    unmount();
    vi.restoreAllMocks();
    stub(() => body([]));
    render(<LegacyDelegationsTable />);
    expect(await screen.findByText("No legacy delegations")).toBeInTheDocument();
  });

  it("shows a retryable error (not the empty state) when the report fails", async () => {
    let n = 0;
    stub(() => (n++ === 0 ? new Response("x", { status: 500 }) : body([legacyRow()])));
    render(<LegacyDelegationsTable />);
    expect(await screen.findByText("We couldn’t load the legacy delegations.")).toBeInTheDocument();
    expect(screen.queryByText("No legacy delegations")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Legacy cover")).toBeInTheDocument();
  });

  it("treats a 403 as no access, with no retry button", async () => {
    stub(() => new Response(JSON.stringify({ code: "FORBIDDEN", message: "RAW" }), { status: 403 }));
    render(<LegacyDelegationsTable />);
    expect(await screen.findByText("You do not have access to this report.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByText("RAW")).not.toBeInTheDocument();
  });

  it("says when more rows exist than were fetched", async () => {
    stub(() => body([legacyRow()], 300));
    render(<LegacyDelegationsTable />);
    expect(await screen.findByRole("note")).toHaveTextContent("Showing 1 of 300.");
  });
});
