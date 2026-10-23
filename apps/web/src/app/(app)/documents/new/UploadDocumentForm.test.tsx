import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }) }));

import { UploadDocumentForm, validateName, type FolderOption } from "./UploadDocumentForm";

const FOLDERS: FolderOption[] = [
  { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Budget", path: "/Budget" },
];

describe("UploadDocumentForm", () => {
  it("NEW-01: renders a real file input (not just name + tags)", () => {
    const { container } = render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it("NEW-02: renders a folder selector populated from the folders prop", () => {
    render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "/Budget" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Root (no folder)" })).toBeInTheDocument();
  });

  it("NEW-03: validateName rejects over-length and blocked extensions, accepts normal names", () => {
    expect(validateName("")).not.toBeNull();
    expect(validateName("x".repeat(501))).not.toBeNull();
    expect(validateName("malware.exe")).not.toBeNull();
    expect(validateName("Budget Report Q3.pdf")).toBeNull();
  });

  it("NEW-03/04: submitting with no file surfaces a role=alert error and blocks", async () => {
    render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
    const fetchSpy = vi.spyOn(global, "fetch");
    fireEvent.change(screen.getByLabelText(/File Name/), { target: { value: "ok.pdf" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Record/ }));
    expect(await screen.findByText("Select a file to upload.")).toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  describe("storageKey linkage", () => {
    const OBJECT_PATH = "uploads/t/document/u/abc.pdf";
    function mockFetch() {
      return vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/admin/uploads/presign")) {
          return new Response(JSON.stringify({ uploadUrl: "https://s3.test/put", key: OBJECT_PATH, headers: {} }), { status: 200 });
        }
        if (URL.canParse(url) && new URL(url).origin === "https://s3.test") return new Response(null, { status: 200 });
        return new Response(JSON.stringify({ id: "x" }), { status: 202 });
      });
    }
    const pick = (container: HTMLElement, name: string) => {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["%PDF"], name, { type: "application/pdf" });
      fireEvent.change(input, { target: { files: [file] } });
      return input;
    };
    const createCalls = (spy: ReturnType<typeof mockFetch>) =>
      spy.mock.calls.filter(([u]) => String(u).endsWith("/v1/documents/files"));

    it("sends the presigned storageKey with the create-file request", async () => {
      const spy = mockFetch();
      const { container } = render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
      pick(container, "a.pdf");
      await screen.findByText(/Uploaded: a\.pdf/);
      fireEvent.click(screen.getByRole("button", { name: /Create Record/ }));
      await waitFor(() => expect(createCalls(spy)).toHaveLength(1));
      const body = JSON.parse(String((createCalls(spy)[0][1] as RequestInit).body));
      expect(body.storageKey).toBe(OBJECT_PATH);
      expect(body.name).toBe("a.pdf");
      spy.mockRestore();
    });

    it("clears the stale storageKey when the uploaded file is removed, so submit is blocked", async () => {
      const spy = mockFetch();
      const { container } = render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
      const input = pick(container, "a.pdf");
      await screen.findByText(/Uploaded: a\.pdf/);
      fireEvent.change(input, { target: { files: [] } });
      fireEvent.click(screen.getByRole("button", { name: /Create Record/ }));
      expect(await screen.findByText("Select a file to upload.")).toBeInTheDocument();
      expect(createCalls(spy)).toHaveLength(0);
      spy.mockRestore();
    });

    it("does not reuse the old storageKey when a replacement upload fails", async () => {
      const spy = mockFetch();
      const { container } = render(<UploadDocumentForm folders={FOLDERS} defaultFolderId={null} />);
      const input = pick(container, "a.pdf");
      await screen.findByText(/Uploaded: a\.pdf/);
      spy.mockImplementation(async () => new Response("{}", { status: 500 }));
      pick(container, "b.pdf");
      await waitFor(() => expect(input).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: /Create Record/ }));
      expect(await screen.findByText("Select a file to upload.")).toBeInTheDocument();
      expect(createCalls(spy)).toHaveLength(0);
      spy.mockRestore();
    });
  });
});
