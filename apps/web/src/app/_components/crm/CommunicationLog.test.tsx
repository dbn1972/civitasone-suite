import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommunicationLog } from "./CommunicationLog";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getCommunications: vi.fn(), createCommunication: vi.fn() };
});

beforeEach(() => {
  vi.mocked(aa.getCommunications).mockReset();
  vi.mocked(aa.createCommunication).mockReset();
});

describe("CommunicationLog (AC-003)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getCommunications).mockResolvedValue({ data: [], source: "error" });
    render(<CommunicationLog subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/showing saved information/i)[0]).toBeInTheDocument());
    expect(screen.getByText(/communications unavailable/i)).toBeInTheDocument();
  });

  it("renders a communication in the timeline", async () => {
    vi.mocked(aa.getCommunications).mockResolvedValue({
      data: [{ id: "c1", direction: "inbound", channel: "whatsapp", summary: "Asked for quote", outcome: "Connected", occurredAt: "2026-05-01T09:00:00Z" }],
      source: "api",
    });
    render(<CommunicationLog subjectType="contact" subjectId="c1" />);
    expect(await screen.findByText("Asked for quote")).toBeInTheDocument();
    expect(screen.getByText(/Inbound · WhatsApp/)).toBeInTheDocument();
  });

  it("blocks save until a summary is entered", async () => {
    vi.mocked(aa.getCommunications).mockResolvedValue({ data: [], source: "api" });
    render(<CommunicationLog subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no communications yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /log communication/i }));
    expect(await screen.findByText(/enter a short summary/i)).toBeInTheDocument();
    expect(aa.createCommunication).not.toHaveBeenCalled();
  });

  it("logs a communication with direction + channel then reloads", async () => {
    vi.mocked(aa.getCommunications).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createCommunication).mockResolvedValue({ accepted: false });
    render(<CommunicationLog subjectType="contact" subjectId="c1" />);
    await waitFor(() => expect(screen.getByText(/no communications yet/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/direction/i), { target: { value: "inbound" } });
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "Emailed the brochure" } });
    fireEvent.click(screen.getByRole("button", { name: /log communication/i }));
    await waitFor(() => expect(aa.createCommunication).toHaveBeenCalled());
    expect(vi.mocked(aa.createCommunication).mock.calls[0][0]).toMatchObject({ direction: "inbound", channel: "email", summary: "Emailed the brochure" });
    expect(vi.mocked(aa.getCommunications)).toHaveBeenCalledTimes(2);
  });
});
