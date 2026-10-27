/**
 * Owner decision D4c #44: the form WARNS about a likely duplicate (same title, location, category, financial year) and
 * never blocks creating the proposal; there is no cost cap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import NewProposalPage from "./page";

const DUP = { id: "11111111-1111-4111-8111-111111111111", workNumber: "WRK/2026/007", status: "draft", createdAt: "2026-05-02T00:00:00.000Z" };

function mockFetch(duplicates: unknown[], opts: { checkOk?: boolean } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/proposals/duplicate-check")) {
      return opts.checkOk === false
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ data: { duplicates, financialYear: "2026-27" } }), { status: 200 });
    }
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "new-id", status: "accepted" }), { status: 202 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
}
const calls = (spy: ReturnType<typeof mockFetch>, pred: (u: string, i?: RequestInit) => boolean) =>
  spy.mock.calls.filter((c) => pred(String(c[0]), c[1] as RequestInit | undefined));

describe("NewProposalPage: likely-duplicate warning (D4c #44)", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("shows a warning with a link to the matching proposal, asking the server for title, category and location", async () => {
    const spy = mockFetch([DUP]);
    render(<NewProposalPage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Repair of the approach road" } });
    fireEvent.change(screen.getByLabelText(/District/i), { target: { value: "Khordha" } });
    const note = await screen.findByTestId("duplicate-proposals-warning", undefined, { timeout: 3000 });
    expect(note).toHaveTextContent(/similar proposal/i);
    expect(note).toHaveTextContent("WRK/2026/007");
    expect(screen.getByRole("link", { name: /WRK\/2026\/007/ })).toHaveAttribute("href", `/works/proposals/${DUP.id}`);
    const [url] = calls(spy, (u) => u.includes("/proposals/duplicate-check"))[0]!;
    expect(String(url)).toContain("description=Repair+of+the+approach+road");
    expect(String(url)).toContain("category=regular");
    expect(String(url)).toContain("district=Khordha");
  });

  it("does not block: the proposal can still be created while the warning is showing", async () => {
    const spy = mockFetch([DUP]);
    render(<NewProposalPage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Repair of the approach road" } });
    fireEvent.change(screen.getByLabelText(/Estimated cost/i), { target: { value: "500000" } });
    await screen.findByTestId("duplicate-proposals-warning", undefined, { timeout: 3000 });
    const submit = screen.getByRole("button", { name: /create draft/i });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(calls(spy, (_u, i) => i?.method === "POST")).toHaveLength(1));
  });

  it("shows nothing when there is no likely duplicate, or when the check cannot run", async () => {
    mockFetch([]);
    const { unmount } = render(<NewProposalPage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "A brand new work" } });
    await waitFor(() => expect(screen.queryByTestId("duplicate-proposals-warning")).toBeNull(), { timeout: 3000 });
    unmount();
    vi.restoreAllMocks();
    mockFetch([DUP], { checkOk: false });
    render(<NewProposalPage />);
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "Another work" } });
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.queryByTestId("duplicate-proposals-warning")).toBeNull();
  });

  it("does not ask the server until a title is typed", async () => {
    const spy = mockFetch([DUP]);
    render(<NewProposalPage />);
    await new Promise((r) => setTimeout(r, 800));
    expect(calls(spy, (u) => u.includes("/proposals/duplicate-check"))).toHaveLength(0);
  });
});
