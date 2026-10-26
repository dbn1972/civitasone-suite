/**
 * UAT owner decision #15 (GAP-KNOWLEDGE-DOCUMENTS-NEW-05): a 409 DUPLICATE_TITLE
 * from the create endpoint is shown as a plain-language message with a link to
 * the existing document; the form never navigates away or claims success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import { CreateDocumentForm } from "./CreateDocumentForm";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, headers: new Headers(), text: async () => JSON.stringify(body), json: async () => body, clone: () => makeRes(ok, status, body) } as unknown as Response;
}

describe("CreateDocumentForm duplicate title (owner decision #15)", () => {
  beforeEach(() => { pushMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a link to the existing document on 409 DUPLICATE_TITLE and does not navigate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes(false, 409, {
      code: "DUPLICATE_TITLE",
      message: "A document with this title already exists.",
      existingDocumentId: "11111111-1111-4111-8111-111111111111",
      existingDocumentHref: "/knowledge/documents/11111111-1111-4111-8111-111111111111",
    })));
    render(<CreateDocumentForm />);
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Leave Policy" } });
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const link = await screen.findByRole("link", { name: "Open the existing document" });
    expect(link).toHaveAttribute("href", "/knowledge/documents/11111111-1111-4111-8111-111111111111");
    expect(screen.getByRole("alert")).toHaveTextContent("A document with this title already exists.");
    await waitFor(() => expect(pushMock).not.toHaveBeenCalled());
    expect(screen.queryByText("Document saved as draft.")).not.toBeInTheDocument();
  });

  it("ignores an href that is not an internal knowledge document path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes(false, 409, {
      code: "DUPLICATE_TITLE", message: "x", existingDocumentHref: "https://evil.example/phish",
    })));
    render(<CreateDocumentForm />);
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Leave Policy" } });
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "Open the existing document" })).not.toBeInTheDocument();
  });
});
