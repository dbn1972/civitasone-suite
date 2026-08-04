import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import NewContactPage from "./page";
import * as dq from "@/lib/crm/dataQuality";
import type { DuplicateCandidate } from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, duplicateCheck: vi.fn() };
});

const fetchMock = vi.fn();
const cand: DuplicateCandidate = { id: "1", matchedFields: ["email"], score: 0.9, name: "Existing Asha" };

beforeEach(() => {
  vi.mocked(dq.duplicateCheck).mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("NewContactPage duplicate-check (DQ-001 findings 1,2,5)", () => {
  it("resets the 'continue anyway' acknowledgement when a dedup field is edited afterwards", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([cand]);

    render(<NewContactPage />);
    // `name` is a mandatory field (LM-001) — fill it so the form passes native
    // constraint validation and the submit handler (which runs the DQ-001 check) fires.
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "asha@x.in" } });

    // First submit surfaces the duplicate and blocks the create (fetch not called).
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    expect(await screen.findByText(/potential duplicates found/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/crm/contacts", expect.anything());

    // Acknowledge → button flips to "Create anyway".
    fireEvent.click(screen.getByRole("button", { name: /continue anyway/i }));
    expect(await screen.findByRole("button", { name: /create anyway/i })).toBeInTheDocument();

    // Editing email must invalidate the ack: label reverts and the panel clears.
    fireEvent.change(email, { target: { value: "asha2@x.in" } });
    expect(screen.getByRole("button", { name: /^create contact$/i })).toBeInTheDocument();
    expect(screen.queryByText(/potential duplicates found/i)).not.toBeInTheDocument();

    // Submitting again re-runs the check (not silently skipped) and blocks once more.
    vi.mocked(dq.duplicateCheck).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^create contact$/i }));
    await waitFor(() => expect(dq.duplicateCheck).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/potential duplicates found/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/crm/contacts", expect.anything());
  });

  it("ignores a stale in-flight check so a newer blur wins (finding 2)", async () => {
    let resolveSlow!: (v: DuplicateCandidate[]) => void;
    const slow = new Promise<DuplicateCandidate[]>((r) => { resolveSlow = r; });
    vi.mocked(dq.duplicateCheck)
      .mockReturnValueOnce(slow)          // first blur (email) — resolves LAST
      .mockResolvedValueOnce([]);         // second blur (phone) — resolves first, empty

    render(<NewContactPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "asha@x.in" } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: "9900000000" } });

    fireEvent.blur(screen.getByLabelText("Email"));   // starts slow check (seq 1)
    fireEvent.blur(screen.getByLabelText(/phone/i));  // starts fast check (seq 2)

    // The newer (empty) result settles first → no panel.
    await waitFor(() => expect(screen.queryByText(/potential duplicates found/i)).not.toBeInTheDocument());

    // Now the stale earlier check resolves with a candidate — it must be ignored.
    await act(async () => { resolveSlow([cand]); await slow; });
    expect(screen.queryByText(/potential duplicates found/i)).not.toBeInTheDocument();
  });

  it("surfaces a source=error affordance (not silent) when the check call fails, without blocking submit", async () => {
    vi.mocked(dq.duplicateCheck).mockRejectedValue(new Error("network"));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "new-1" }) });

    render(<NewContactPage />);
    // Mandatory field (LM-001) so the form submits on click.
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "asha@x.in" } });
    fireEvent.blur(screen.getByLabelText("Email"));
    expect(await screen.findByText(/duplicate check unavailable/i)).toBeInTheDocument();

    // Submit still proceeds to create despite the failed check.
    fireEvent.click(screen.getByRole("button", { name: /create contact/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/crm/contacts", expect.anything()));
  });
});
