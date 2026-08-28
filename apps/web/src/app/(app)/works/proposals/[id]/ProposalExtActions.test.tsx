import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

import { ProposalExtActions } from "./ProposalExtActions";

const WORK_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

// The accordion header's accessible name includes the expand/collapse glyph
// ("▸"/"▾") appended with no separating space, so match on the label prefix.
function openSection(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
}

describe("ProposalExtActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing for a user without a proposal write role", () => {
    const { container } = renderWithToast(
      <ProposalExtActions workId={WORK_ID} roles={["viewer"]} />,
    );
    expect(container).not.toHaveTextContent("Split Proposal");
  });

  describe("Split Proposal (L4: irreversible — creates a new permanent child work record)", () => {
    it("does NOT fire the split POST on the bare submit click", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderWithToast(<ProposalExtActions workId={WORK_ID} roles={["works_admin"]} />);

      openSection("Split Proposal");
      fireEvent.change(screen.getByPlaceholderText("Describe the sub-work scope"), {
        target: { value: "Bridge approach road — sub-work" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Split Proposal" }));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(
        screen.getByText(/creates a new permanent child work record/),
      ).toBeInTheDocument();
    });

    it("fires the split POST only after the user confirms, and shows the child-work result", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { id: "cccccccc-dddd-eeee-ffff-000000000000", workNumber: "WK/2026/0042" },
          }),
          { status: 202 },
        ),
      );
      renderWithToast(<ProposalExtActions workId={WORK_ID} roles={["works_admin"]} />);

      openSection("Split Proposal");
      fireEvent.change(screen.getByPlaceholderText("Describe the sub-work scope"), {
        target: { value: "Bridge approach road — sub-work" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Split Proposal" }));

      const dialog = screen.getByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Split" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/proxy/v1/works/proposals/split");
      expect((init as RequestInit).method).toBe("POST");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        parentWorkId: WORK_ID,
        description: "Bridge approach road — sub-work",
      });

      expect(await screen.findByText("✅ Split created")).toBeInTheDocument();
    });
  });

  describe("Map COA (append-only — no update/delete endpoint, so a wrong mapping is permanent)", () => {
    it("does NOT fire the COA-mapping POST on the bare submit click", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderWithToast(<ProposalExtActions workId={WORK_ID} roles={["works_admin"]} />);

      openSection("Map COA");
      fireEvent.change(screen.getByPlaceholderText("e.g. 4059"), { target: { value: "4059" } });
      fireEvent.click(screen.getByRole("button", { name: "Map COA" }));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(
        screen.getByText(/Mappings cannot be edited or removed once submitted/),
      ).toBeInTheDocument();
    });

    it("fires the COA-mapping POST only after confirming, then collapses the section", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
      renderWithToast(<ProposalExtActions workId={WORK_ID} roles={["works_admin"]} />);

      openSection("Map COA");
      fireEvent.change(screen.getByPlaceholderText("e.g. 4059"), { target: { value: "4059" } });
      fireEvent.click(screen.getByRole("button", { name: "Map COA" }));

      const dialog = screen.getByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm COA Mapping" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/proxy/v1/works/proposals/coa");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        workId: WORK_ID,
        majorHead: "4059",
      });

      // onSuccess collapses the accordion section (the field unmounts).
      await waitFor(() =>
        expect(screen.queryByPlaceholderText("e.g. 4059")).not.toBeInTheDocument(),
      );
    });
  });

  describe("Map Office (append-only — no update/delete endpoint, so a wrong mapping is permanent)", () => {
    it("does NOT fire the office-mapping POST on the bare submit click", () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderWithToast(<ProposalExtActions workId={WORK_ID} roles={["works_admin"]} />);

      openSection("Map Office");
      fireEvent.change(screen.getByPlaceholderText("Division UUID"), {
        target: { value: "11111111-1111-1111-1111-111111111111" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Map Office" }));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(
        screen.getByText(/Mappings cannot be edited or removed once submitted/),
      ).toBeInTheDocument();
    });

    it("fires the office-mapping POST only after confirming, then collapses the section", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 202 }));
      renderWithToast(<ProposalExtActions workId={WORK_ID} roles={["works_admin"]} />);

      openSection("Map Office");
      fireEvent.change(screen.getByPlaceholderText("Division UUID"), {
        target: { value: "11111111-1111-1111-1111-111111111111" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Map Office" }));

      const dialog = screen.getByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Office Mapping" }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/proxy/v1/works/proposals/office-mapping");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        workId: WORK_ID,
        divisionId: "11111111-1111-1111-1111-111111111111",
        isNodal: false,
      });

      await waitFor(() =>
        expect(screen.queryByPlaceholderText("Division UUID")).not.toBeInTheDocument(),
      );
    });
  });
});
