import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import { AdvocatesManager } from "./AdvocatesManager";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ADV = { id: "a1", name: "Adv. Kavita Rao", barEnrolmentNo: "D/1234/2011", contact: "••••••••10" };

describe("AdvocatesManager (GAP-LEGAL-LIST-04, decision #14)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a distinct empty state, and a retryable error state when the load fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    const { unmount } = render(<AdvocatesManager />);
    expect(await screen.findByText("No advocates are empanelled yet.")).toBeInTheDocument();
    unmount();
    fetchMock.mockResolvedValueOnce(json({}, 503));
    render(<AdvocatesManager />);
    expect(await screen.findByText("The advocate list could not be loaded. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("No advocates are empanelled yet.")).not.toBeInTheDocument();
  });

  it("lists advocates with the (server-masked) contact", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [ADV] }));
    render(<AdvocatesManager />);
    expect(await screen.findByText("Adv. Kavita Rao")).toBeInTheDocument();
    expect(screen.getByText("D/1234/2011")).toBeInTheDocument();
    expect(screen.getByText("••••••••10")).toBeInTheDocument();
  });

  it("adds an advocate, then reloads the list", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    render(<AdvocatesManager />);
    await screen.findByText("No advocates are empanelled yet.");
    fetchMock.mockResolvedValueOnce(json({ id: "n1", status: "accepted" }, 202)).mockResolvedValueOnce(json({ items: [ADV] }));
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Adv. Kavita Rao" } });
    fireEvent.change(screen.getByLabelText("Bar enrolment number *"), { target: { value: "D/1234/2011" } });
    fireEvent.change(screen.getByLabelText("Phone or email *"), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Empanel advocate" }));
    expect(await screen.findByText("Adv. Kavita Rao", {}, { timeout: 3000 })).toBeInTheDocument();
    const post = fetchMock.mock.calls[1]!;
    expect(post[0]).toBe("/api/proxy/v1/legal/advocates");
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ name: "Adv. Kavita Rao", barEnrolmentNo: "D/1234/2011", contact: "9876543210" });
  });

  it("maps 409 to a duplicate message and 403 to an admin-only message, without raw server text", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    render(<AdvocatesManager />);
    await screen.findByText("No advocates are empanelled yet.");
    const fill = () => {
      fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "A" } });
      fireEvent.change(screen.getByLabelText("Bar enrolment number *"), { target: { value: "D/1/2011" } });
      fireEvent.change(screen.getByLabelText("Phone or email *"), { target: { value: "9876543210" } });
      fireEvent.click(screen.getByRole("button", { name: "Empanel advocate" }));
    };
    fetchMock.mockResolvedValueOnce(json({ code: "DUPLICATE_BAR_ENROLMENT", message: "internal detail" }, 409));
    fill();
    expect(await screen.findByText("An advocate with this Bar enrolment number is already empanelled.")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(json({ code: "FORBIDDEN", message: "requires one of: legal_admin" }, 403));
    fill();
    await waitFor(() => expect(screen.getByText("Only the head of legal can add advocates.")).toBeInTheDocument());
    expect(screen.queryByText(/requires one of/)).not.toBeInTheDocument();
  });
});
