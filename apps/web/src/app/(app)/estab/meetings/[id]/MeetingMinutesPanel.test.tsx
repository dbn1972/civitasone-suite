import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const fetchMinutes = vi.fn();
const createMinutes = vi.fn();
vi.mock("../../../meeting/_data/client", () => ({
  fetchMinutes: (...a: unknown[]) => fetchMinutes(...a),
  createMinutes: (...a: unknown[]) => createMinutes(...a),
}));

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/browserClient")>();
  return { ...actual, browserFetch: (...a: unknown[]) => browserFetch(...a) };
});

import { MeetingMinutesPanel } from "./MeetingMinutesPanel";

const GOV = "11111111-1111-4111-8111-111111111111";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const minutes = (status: string) => ({
  id: "mm1", meetingId: GOV, templateType: "summary", content: "x", status, currentVersion: 1, version: 1,
  approvedBy: null, approvedAt: null, dscSignerName: null, dscSignedAt: null, hashCurrent: null,
  createdBy: "u1", createdAt: null, updatedAt: null,
});

beforeEach(() => {
  refresh.mockReset(); fetchMinutes.mockReset(); createMinutes.mockReset(); browserFetch.mockReset();
});

// Owner decision #30 (GAP-ESTAB-MEETINGS-DETAIL-04): the MOM is produced through meeting-service's
// minutes workflow (draft -> approve) and linked from the estab meeting.
describe("MeetingMinutesPanel (owner decision #30)", () => {
  describe("not linked yet", () => {
    it("explains the MOM comes from the meetings module and offers to link a meeting", () => {
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={null} />);
      expect(screen.getByText(/Minutes are drafted and approved in the Meetings module/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Link a meeting/i })).toBeInTheDocument();
      expect(fetchMinutes).not.toHaveBeenCalled();
      expect(browserFetch).not.toHaveBeenCalled(); // no network until the user asks
    });

    it("lists meetings from the meetings module and links the chosen one", async () => {
      browserFetch.mockImplementation(async (path: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return json(202, { id: "m1", status: "accepted" });
        return json(200, { data: [
          { id: GOV, title: "Establishment Committee Q1", scheduledAt: "2026-03-01T10:00:00Z" },
          { id: "22222222-2222-4222-8222-222222222222", title: "Other", scheduledAt: null },
        ] });
      });
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={null} />);
      fireEvent.click(screen.getByRole("button", { name: /Link a meeting/i }));
      const select = (await screen.findByLabelText(/Meeting with the minutes/i)) as HTMLSelectElement;
      expect(within(select).getAllByRole("option").length).toBeGreaterThanOrEqual(2);
      fireEvent.change(select, { target: { value: GOV } });
      fireEvent.click(screen.getByRole("button", { name: /^Link$/i }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      const patch = browserFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
      expect(patch[0]).toBe("v1/estab/meetings/m1/governance-link");
      expect(JSON.parse(String((patch[1] as RequestInit).body))).toEqual({ governanceMeetingId: GOV });
    });

    it("says the meetings list could not be loaded (not 'no meetings') when the fetch fails", async () => {
      browserFetch.mockResolvedValue(json(500, {}));
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={null} />);
      fireEvent.click(screen.getByRole("button", { name: /Link a meeting/i }));
      expect(await screen.findByText(/couldn't load the meetings list/i)).toBeInTheDocument();
      expect(screen.queryByText(/No meetings found/i)).not.toBeInTheDocument();
    });

    it("says there are no meetings (with a way to create one) when the module genuinely has none", async () => {
      browserFetch.mockResolvedValue(json(200, { data: [] }));
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={null} />);
      fireEvent.click(screen.getByRole("button", { name: /Link a meeting/i }));
      expect(await screen.findByText(/No meetings found in the Meetings module/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Schedule a meeting/i })).toHaveAttribute("href", "/meeting/meetings/new");
    });

    it("shows a humane error, not the raw response, when linking fails (409 already linked)", async () => {
      browserFetch.mockImplementation(async (_p: string, init?: RequestInit) =>
        init?.method === "PATCH" ? json(409, { code: "DUPLICATE_LINK", message: "pg: unique violation" }) : json(200, { data: [{ id: GOV, title: "Q1", scheduledAt: null }] }));
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={null} />);
      fireEvent.click(screen.getByRole("button", { name: /Link a meeting/i }));
      fireEvent.change(await screen.findByLabelText(/Meeting with the minutes/i), { target: { value: GOV } });
      fireEvent.click(screen.getByRole("button", { name: /^Link$/i }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toMatch(/pg: unique/i);
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("linked", () => {
    it("no minutes yet: offers to start the draft, which creates it in the meetings module", async () => {
      fetchMinutes.mockResolvedValue(null);
      createMinutes.mockResolvedValue({ id: "mm1" });
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={GOV} />);
      expect(await screen.findByText(/No minutes have been drafted yet/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Start draft minutes/i }));
      await waitFor(() => expect(createMinutes).toHaveBeenCalledWith(GOV));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it.each([
      ["draft", /Draft/i],
      ["submitted", /Awaiting approval/i],
      ["approved", /Approved/i],
    ])("a %s minutes record shows its state and links into the workflow", async (status, label) => {
      fetchMinutes.mockResolvedValue(minutes(status));
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={GOV} />);
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open minutes workflow/i })).toHaveAttribute("href", `/meeting/meetings/${GOV}/minutes`);
      expect(screen.queryByRole("button", { name: /Start draft minutes/i })).not.toBeInTheDocument();
    });

    it("a failed minutes read is an error state (not 'no minutes') and still links to the workflow", async () => {
      fetchMinutes.mockRejectedValue(new Error("boom"));
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={GOV} />);
      expect(await screen.findByText(/couldn't load the minutes/i)).toBeInTheDocument();
      expect(screen.queryByText(/No minutes have been drafted yet/i)).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open minutes workflow/i })).toBeInTheDocument();
    });

    it("surfaces a humane error (no raw text) when starting the draft fails", async () => {
      fetchMinutes.mockResolvedValue(null);
      createMinutes.mockRejectedValue(new Error("403 forbidden"));
      render(<MeetingMinutesPanel estabMeetingId="m1" governanceMeetingId={GOV} />);
      fireEvent.click(await screen.findByRole("button", { name: /Start draft minutes/i }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toMatch(/403/);
    });
  });
});
