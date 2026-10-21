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
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AccountParentForm } from "./AccountParentForm";

function renderForm() {
  return render(<AccountParentForm accountId="acc-1" accountName="Test Account" currentParentId={null} />);
}

async function openAndSave() {
  fireEvent.click(screen.getByRole("button", { name: "Change Parent" }));
  fireEvent.click(screen.getByRole("button", { name: "Save hierarchy" }));
  // GAP-CRM-ACCOUNTS-DETAIL-03: Save now opens a ConfirmDialog; confirm it to
  // actually perform the move.
  await waitFor(() => expect(screen.getByRole("button", { name: "Move account" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Move account" }));
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

    await waitFor(() => expect(screen.getByText(/We couldn't connect\. Check your internet connection and try again\./)).toBeInTheDocument());
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

  // GAP-CRM-ACCOUNTS-DETAIL-03
  it("asks for confirmation before sending the PATCH", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    render(
      <AccountParentForm accountId="acc-1" accountName="Test Account" currentParentId={null} subtreeSize={3} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change Parent" }));
    fireEvent.click(screen.getByRole("button", { name: "Save hierarchy" }));
    // Dialog is shown; no request yet.
    await waitFor(() => expect(screen.getByRole("button", { name: "Move account" })).toBeInTheDocument());
    expect(screen.getByText(/3 sub-accounts/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-CRM-ACCOUNTS-DETAIL-01: the parent is found by a SERVER-SIDE search (this
  // account and its whole subtree excluded by the server), not picked from a
  // pre-loaded capped list.
  describe("server-side parent search", () => {
    function mockApi(patchStatus = 204) {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (init?.method === "PATCH") return new Response(null, { status: patchStatus });
        if (url.startsWith("/api/proxy/v1/crm/accounts?")) {
          return new Response(
            JSON.stringify({ data: [{ id: "p-far", name: "Far Away Ministry", industry: "Energy", parentId: null, contactCount: 0 }] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      });
    }

    it("searches the server with the account's subtree excluded and moves under the picked account", async () => {
      const fetchSpy = mockApi();
      render(<AccountParentForm accountId="acc-1" accountName="Test Account" currentParentId={null} subtreeSize={2} />);
      fireEvent.click(screen.getByRole("button", { name: "Change Parent" }));
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "far" } });

      const option = await screen.findByRole("option", { name: /Far Away Ministry/ });
      const searchUrl = fetchSpy.mock.calls.map((c) => String(c[0])).find((u) => u.includes("search=far"))!;
      const params = new URL(searchUrl, "http://x").searchParams;
      expect(params.get("search")).toBe("far");
      expect(params.get("excludeSubtreeOf")).toBe("acc-1");
      expect(params.get("limit")).toBe("10");

      fireEvent.mouseDown(option);
      fireEvent.click(screen.getByRole("button", { name: "Save hierarchy" }));
      // The confirmation names the chosen parent (a label the picker saw), not "another account".
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Far Away Ministry")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Move account" }));

      await waitFor(() => {
        const patch = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
        expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ parentId: "p-far" });
      });
    });

    it("'Make top level' clears the current parent and PATCHes parentId null", async () => {
      const fetchSpy = mockApi();
      render(
        <AccountParentForm accountId="acc-1" accountName="Test Account" currentParentId="p1" currentParentName="Parent Org" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Change Parent" }));
      // The picker opens labelled with the current parent's name (no id shown).
      expect(screen.getByRole("combobox")).toHaveValue("Parent Org");
      fireEvent.click(screen.getByRole("button", { name: "Make top level (no parent)" }));
      fireEvent.click(screen.getByRole("button", { name: "Save hierarchy" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Move account" }));
      await waitFor(() => {
        const patch = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
        expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ parentId: null });
      });
    });

    it("shows a 'could not load' alert (not 'no matches') when the account search fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
      render(<AccountParentForm accountId="acc-1" accountName="Test Account" currentParentId={null} />);
      fireEvent.click(screen.getByRole("button", { name: "Change Parent" }));
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "far" } });
      expect(await screen.findByText("Couldn’t load accounts. Please try again.")).toBeInTheDocument();
      expect(screen.queryByText("No matching accounts")).not.toBeInTheDocument();
    });
  });

  it("cancelling the confirm makes no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Change Parent" }));
    fireEvent.click(screen.getByRole("button", { name: "Save hierarchy" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
