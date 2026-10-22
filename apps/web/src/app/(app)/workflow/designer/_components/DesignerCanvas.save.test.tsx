import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DesignerCanvas } from "./DesignerCanvas";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// GAP-WORKFLOW-DESIGNER-01: unsaved work is guarded and Save is blocked while
// the last validation run found problems.
describe("DesignerCanvas save guard", () => {
  it("is clean on load, dirty after an edit (beforeunload guard), and blocks Save after a failed validation", async () => {
    render(<DesignerCanvas definitions={[]} canAuthor />);

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Leave approval v2" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    // An empty graph has no start/end event, so validation fails and Save is blocked.
    fireEvent.click(screen.getByLabelText("Validate workflow graph"));
    const save = await screen.findByRole("button", { name: /save as draft/i });
    expect(save).toBeDisabled();
  });
});

// Save must update the draft that was opened (PATCH + optimistic-locking version),
// not mint a duplicate draft with POST on every click.
describe("DesignerCanvas save target", () => {
  const ID = "22222222-3333-4444-8555-666666666666";

  it("PATCHes an opened draft with its version, and bumps the version for the next save", async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === "GET") {
        return new Response(JSON.stringify({ data: { name: "Leave flow", version: 3, elements: [], edges: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: ID, status: "accepted", correlationId: "c" }), { status: 202 });
    }));
    render(<DesignerCanvas definitions={[]} initialDefinitionId={ID} canAuthor />);
    await waitFor(() => expect((screen.getByLabelText("Workflow name") as HTMLInputElement).value).toBe("Leave flow"));

    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    expect(await screen.findByText("Draft updated.")).toBeInTheDocument();
    const first = calls.filter((c) => c.method !== "GET");
    expect(first).toHaveLength(1);
    expect(first[0]!.method).toBe("PATCH");
    expect(first[0]!.url).toBe(`/api/proxy/v1/workflow/designer/definitions/${ID}`);
    expect(first[0]!.body).toMatchObject({ name: "Leave flow", version: 3 });

    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(calls.filter((c) => c.method !== "GET")).toHaveLength(2));
    expect(calls.filter((c) => c.method !== "GET")[1]!.body).toMatchObject({ version: 4 });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a brand-new graph is created with POST, and the next save then PATCHes that draft", async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: ID, status: "accepted", correlationId: "c" }), { status: 202 });
    }));
    render(<DesignerCanvas definitions={[]} canAuthor />);
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    expect(await screen.findByText("Saved as a new draft.")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/proxy/v1/workflow/designer/definitions" });

    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ method: "PATCH", url: `/api/proxy/v1/workflow/designer/definitions/${ID}` });
    expect(calls[1]!.body).toMatchObject({ version: 1 });
  });

  it("explains a 409 version conflict instead of silently creating a duplicate", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ data: { name: "Leave flow", version: 3, elements: [], edges: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: "VERSION_CONFLICT" }), { status: 409 });
    }));
    render(<DesignerCanvas definitions={[]} initialDefinitionId={ID} canAuthor />);
    await waitFor(() => expect((screen.getByLabelText("Workflow name") as HTMLInputElement).value).toBe("Leave flow"));
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed elsewhere/i);
  });
});
