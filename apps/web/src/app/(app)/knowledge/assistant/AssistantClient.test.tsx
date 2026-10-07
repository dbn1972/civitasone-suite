import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));

import { AssistantClient } from "./AssistantClient";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: () => makeRes(ok, status, body),
  } as unknown as Response;
}

const answered = {
  interactionId: "11111111-1111-1111-1111-111111111111",
  answer: "Apply via HRMS.",
  citations: [
    { docId: "aaaaaaaa-0000-0000-0000-000000000001", title: "Leave Policy", source: "policy" },
    { docId: "bbbbbbbb-0000-0000-0000-000000000002", title: "HR Handbook", source: "document" },
  ],
  answered: true,
  grounded: true,
};

describe("AssistantClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    refreshMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  // GAP-KNOWLEDGE-ASSISTANT-01: a 500 with a raw body must never reach the user;
  // the error region must be role="alert" and show only the friendly message.
  it("shows a friendly role=alert error on 500 and never the raw body", async () => {
    fetchMock.mockResolvedValue(makeRes(false, 500, { stack: "SECRET STACK TRACE", message: "db exploded" }));
    render(<AssistantClient />);
    fireEvent.change(screen.getByPlaceholderText(/annual leave/i), { target: { value: "how?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).not.toContain("SECRET STACK TRACE");
    expect(alert.textContent).not.toContain("db exploded");
  });

  // GAP-KNOWLEDGE-ASSISTANT-03: two quick Enter keydowns must only fire one fetch.
  it("fires ask only once for rapid double Enter", async () => {
    fetchMock.mockResolvedValue(makeRes(true, 200, { data: answered }));
    render(<AssistantClient />);
    const input = screen.getByPlaceholderText(/annual leave/i);
    fireEvent.change(input, { target: { value: "how?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  // GAP-KNOWLEDGE-ASSISTANT-05: policy citations link to the policy detail page.
  it("links policy citations to /knowledge/policies/{id}, others are plain", async () => {
    fetchMock.mockResolvedValue(makeRes(true, 200, { data: answered }));
    render(<AssistantClient />);
    fireEvent.change(screen.getByPlaceholderText(/annual leave/i), { target: { value: "leave?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const link = await screen.findByRole("link", { name: "Leave Policy" });
    expect(link).toHaveAttribute("href", "/knowledge/policies/aaaaaaaa-0000-0000-0000-000000000001");
    expect(screen.queryByRole("link", { name: "HR Handbook" })).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-ASSISTANT-05: an ungrounded answer shows a notice.
  it("shows an ungrounded notice when grounded=false", async () => {
    fetchMock.mockResolvedValue(makeRes(true, 200, { data: { ...answered, grounded: false, citations: [] } }));
    render(<AssistantClient />);
    fireEvent.change(screen.getByPlaceholderText(/annual leave/i), { target: { value: "x?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/not grounded in a source document/i)).toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-ASSISTANT-04: priority is sent and the ticket reference is shown.
  it("sends the selected priority and displays the ticket reference", async () => {
    fetchMock
      .mockResolvedValueOnce(makeRes(true, 200, { data: { ...answered, answered: false } }))
      .mockResolvedValueOnce(makeRes(true, 200, { id: "cccccccc-0000-0000-0000-000000000003", status: "accepted", correlationId: "c" }));
    render(<AssistantClient />);
    fireEvent.change(screen.getByPlaceholderText(/annual leave/i), { target: { value: "unanswerable?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(/couldn/i);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: /Escalate to support ticket/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const escalateCall = fetchMock.mock.calls[1]!;
    expect(JSON.parse((escalateCall[1] as RequestInit).body as string).priority).toBe("High");
    expect(await screen.findByText(/Ref: CCCCCCCC/)).toBeInTheDocument();
  });
});
