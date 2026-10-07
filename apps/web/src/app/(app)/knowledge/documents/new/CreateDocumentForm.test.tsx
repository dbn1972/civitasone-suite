import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import { CreateDocumentForm } from "./CreateDocumentForm";
import { KNOWLEDGE_CATEGORIES } from "../../_data/categories";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, headers: new Headers(), json: async () => body, clone: () => makeRes(ok, status, body) } as unknown as Response;
}

describe("CreateDocumentForm (NEW-01, NEW-03, NEW-04)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    pushMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  // GAP-KNOWLEDGE-DOCUMENTS-NEW-04: button says "Add document", not "Publish".
  it("submit button reads 'Add document' not 'Publish'", () => {
    render(<CreateDocumentForm />);
    expect(screen.getByRole("button", { name: "Add document" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish/i })).not.toBeInTheDocument();
  });

  // GAP-KNOWLEDGE-DOCUMENTS-NEW-03: category is a <select> from the canonical list.
  it("category is a select backed by the canonical category list", () => {
    render(<CreateDocumentForm />);
    const select = screen.getByLabelText("Category");
    expect(select.tagName).toBe("SELECT");
    for (const cat of KNOWLEDGE_CATEGORIES) {
      expect(within(select as HTMLSelectElement).getByRole("option", { name: cat })).toBeInTheDocument();
    }
  });

  // GAP-KNOWLEDGE-DOCUMENTS-NEW-01: access level select exists, defaults to "internal".
  it("access level select defaults to internal and sends in request body", async () => {
    fetchMock.mockResolvedValue(makeRes(true, 202, { id: "x", status: "accepted" }));
    render(<CreateDocumentForm />);
    const alSelect = screen.getByLabelText("Access level");
    expect(alSelect.tagName).toBe("SELECT");
    expect((alSelect as HTMLSelectElement).value).toBe("internal");
    // Change to restricted
    fireEvent.change(alSelect, { target: { value: "restricted" } });
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Confidential Doc" } });
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.accessLevel).toBe("restricted");
    expect(body.title).toBe("Confidential Doc");
  });

  it("posts title + category + accessLevel and navigates on success", async () => {
    fetchMock.mockResolvedValue(makeRes(true, 202, { id: "x", status: "accepted" }));
    render(<CreateDocumentForm />);
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "New Circular" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Circular" } });
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ title: "New Circular", category: "Circular", accessLevel: "internal" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/knowledge/repository"));
  });

  it("blocks submit with no title and sends no request", async () => {
    render(<CreateDocumentForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Document title is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
