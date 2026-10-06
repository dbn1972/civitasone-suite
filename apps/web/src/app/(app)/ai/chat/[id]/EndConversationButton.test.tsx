/**
 * GAP-AI-CHAT-DETAIL-01 — ending a conversation goes through a danger
 * ConfirmDialog that requires a reason (>= 10 chars); the request does not fire
 * on the first click, and Cancel leaves the conversation active.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { EndConversationButton } from "./EndConversationButton";

const ID = "aaaaaaaa-1111-4000-8000-000000000001"; // gitleaks:allow

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("EndConversationButton (GAP-AI-CHAT-DETAIL-01)", () => {
  it("does not call the service on the first click — it opens a confirm dialog", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EndConversationButton conversationId={ID} version={1} />);

    fireEvent.click(screen.getByRole("button", { name: "End conversation" }));
    // A dialog appears; the fetch has NOT been made yet.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps Confirm disabled until the reason reaches 10 characters, then calls the service", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<EndConversationButton conversationId={ID} version={3} />);

    fireEvent.click(screen.getByRole("button", { name: "End conversation" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "End conversation" });
    expect(confirm).toBeDisabled();

    // Too short — still disabled, still no call.
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "short" } });
    expect(confirm).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    // >= 10 chars — enabled; confirming fires the request with version + reason.
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "citizen issue resolved offline" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/api/proxy/v1/ai/chat/${ID}/end`);
    const body = JSON.parse((init as { body: string }).body);
    expect(body.version).toBe(3);
    expect(body.reason).toBe("citizen issue resolved offline");
  });

  it("Cancel closes the dialog without calling the service", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EndConversationButton conversationId={ID} version={1} />);

    fireEvent.click(screen.getByRole("button", { name: "End conversation" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
