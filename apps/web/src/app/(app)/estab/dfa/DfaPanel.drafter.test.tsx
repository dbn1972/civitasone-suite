import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/_components/ds")>();
  return {
    ...actual,
    EntityPicker: ({ onChange }: { onChange: (v: string | null) => void }) => (
      <button type="button" onClick={() => onChange("5a5a5a5a-0000-4000-8000-00000000f11e")}>pick file</button>
    ),
  };
});

import { DfaPanel } from "./DfaPanel";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const FILE_ID = "5a5a5a5a-0000-4000-8000-00000000f11e";
const DRAFTER = "7b7b7b7b-0000-4000-8000-0000000000d1";
const LONG_BODY = `START ${"para ".repeat(180)}END-OF-BODY`;
const dfa = (over: Record<string, unknown>) => ({
  id: "d1", dfaNo: "DFA-001", communicationType: "letter", subject: "Allotment order", status: "pending_approval",
  editable: false, recipientName: "R. Kumar", fileId: null, body: LONG_BODY, createdBy: DRAFTER,
  createdByName: "Meera Nair", updatedAt: "2026-10-01T00:00:00Z", ...over,
});

describe("DfaPanel — GAP-ESTAB-DFA-04", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("shows who drafted it by name and links the eOffice file, never an id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [dfa({ fileId: FILE_ID, fileNo: "EST/2026/114" }), dfa({ id: "d2", dfaNo: "DFA-002", createdByName: null })] }));
    render(<DfaPanel canApprove canDraft viewerId="someone-else" />);
    expect(await screen.findByText("Meera Nair")).toBeInTheDocument();
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "EST/2026/114" })).toHaveAttribute("href", `/estab/files/${FILE_ID}`);
    expect(document.body.textContent).not.toContain("7b7b7b7b");
    expect(document.body.textContent).not.toContain("5a5a5a5a");
  });

  it("Given a long draft, When the approver opens Approve, Then the FULL body is readable (not truncated)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [dfa({})] }));
    render(<DfaPanel canApprove canDraft viewerId="someone-else" />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("END-OF-BODY");
    expect(dialog.textContent).not.toContain("…");
  });

  it("GAP-ESTAB-DFA-04: Given a file is picked on the create form, Then the POST carries its fileId", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_i, init) =>
      (init as RequestInit | undefined)?.method === "POST" ? json({ status: "accepted" }) : json({ data: [] }));
    render(<DfaPanel canApprove canDraft viewerId="someone-else" />);
    fireEvent.click(await screen.findByRole("button", { name: "+ New draft" }));
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: "Linked letter" } });
    fireEvent.change(screen.getByLabelText(/Draft body/i), { target: { value: "Body" } });
    fireEvent.click(screen.getByText("pick file"));
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    await vi.waitFor(() => {
      const post = spy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post![1] as RequestInit).body)).fileId).toBe(FILE_ID);
    });
  });
});
