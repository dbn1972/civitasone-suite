import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CRMAccountSummary } from "@civitasone/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AccountParentForm } from "./AccountParentForm";

const OPTIONS: CRMAccountSummary[] = [
  { id: "p1", name: "Parent Org", industry: null, website: null, parentId: null, contactCount: 0 },
];

function renderForm() {
  return render(
    <AccountParentForm accountId="acc-1" accountName="Test Account" currentParentId={null} options={OPTIONS} />,
  );
}

async function openAndSave() {
  fireEvent.click(screen.getByRole("button", { name: "Change Parent" }));
  fireEvent.click(screen.getByRole("button", { name: "Save hierarchy" }));
}

describe("AccountParentForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("keeps the specific CYCLE_DETECTED message as a special case", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "CYCLE_DETECTED", message: "cycle detected: acc-1 -> p1 -> acc-1" }),
        { status: 422 },
      ),
    );

    renderForm();
    await openAndSave();

    await waitFor(() =>
      expect(
        screen.getByText("That move would make the account its own ancestor. Pick a different parent."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/cycle detected: acc-1/)).not.toBeInTheDocument();
  });

  // UX-023: for any code other than CYCLE_DETECTED, this component used to
  // fall through to a bare `body.message || "..."`, echoing whatever raw
  // string the backend sent verbatim -- invisible to raw-status-leak-guard.mjs
  // because that fallback has no interpolated HTTP status and no tracked
  // "<Verb> failed" literal for the guard to match.
  it("never shows the raw backend message for a non-CYCLE_DETECTED failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "INTERNAL_ERROR",
          message: 'duplicate key value violates unique constraint "accounts_parent_fk"',
        }),
        { status: 500 },
      ),
    );

    renderForm();
    await openAndSave();

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/duplicate key value/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unique constraint/)).not.toBeInTheDocument();
  });

  it("never shows raw text for a non-JSON failure body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } }),
    );

    renderForm();
    await openAndSave();

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Internal Server Error$/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message on a network exception, never the raw error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    renderForm();
    await openAndSave();

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it("updates the hierarchy and refreshes on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    renderForm();
    await openAndSave();

    await waitFor(() =>
      expect(
        screen.getByText("Hierarchy updated. The change appears once processing completes."),
      ).toBeInTheDocument(),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
