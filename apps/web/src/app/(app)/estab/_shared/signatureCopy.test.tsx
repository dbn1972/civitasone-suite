/**
 * One honest statement about the signature (GAP-ESTAB-APPROVALS-02).
 *
 * The approvals queue, the DFA panel and the file-detail sign dialog all describe what approving or
 * signing does. They must say the same thing about DSC, from one place, so the product never makes
 * contradictory legal claims about what the signature is.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import {
  APPROVAL_RECORDS_COPY, DSC_NOT_APPLIED_COPY, NOTE_SIGN_RECORDS_COPY, SIGN_RECORDS_COPY,
} from "./signatureCopy";

let mockSearch = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => mockSearch,
}));

import { DfaPanel } from "../dfa/DfaPanel";
import { FileDetailActions } from "../files/[id]/FileDetailActions";
import { EstabApprovalsPanel } from "../approvals/EstabApprovalsPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("shared signature copy", () => {
  it("every surface carries the same DSC sentence, and none claims a DSC e-signature", () => {
    for (const copy of [APPROVAL_RECORDS_COPY, SIGN_RECORDS_COPY, NOTE_SIGN_RECORDS_COPY]) {
      expect(copy).toContain(DSC_NOT_APPLIED_COPY);
      expect(copy).not.toMatch(/DSC e-?sign|e-?signed|arrives in phase/i);
    }
  });
});

describe("the dialogs show that shared copy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearch = new URLSearchParams();
  });

  it("DfaPanel's Sign dialog shows SIGN_RECORDS_COPY (no 'Phase 2' promise)", async () => {
    const dfa = {
      id: "dfa-s", dfaNo: "DFA-S01", communicationType: "letter", subject: "Sign me", status: "approved",
      editable: false, recipientName: null, updatedAt: "2026-10-01T00:00:00Z", fileId: null, createdBy: "drafter-1",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ data: [dfa] }));
    render(<DfaPanel canApprove canDraft viewerId="approver-2" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(SIGN_RECORDS_COPY);
    expect(dialog.textContent).not.toMatch(/Phase 2/);
  });

  it("the Approvals queue's Approve dialog shows APPROVAL_RECORDS_COPY, which ends in the same DSC sentence as the DFA one", async () => {
    const task = { id: "t1", name: "Review", status: "pending", refType: "estab_file", refId: "11111111-1111-4111-8111-111111111111", roleRef: "estab_under_secretary" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("/v1/workflow/tasks")
        ? jsonResponse({ data: [task], pagination: { hasMore: false } })
        : jsonResponse({ fileNo: "EST/1", subject: "S", noteSheets: [] }));
    render(<EstabApprovalsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(APPROVAL_RECORDS_COPY);
    expect(dialog.textContent).toContain(DSC_NOT_APPLIED_COPY);
  });

  it("the file-detail 'Sign note' dialog shows NOTE_SIGN_RECORDS_COPY", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<FileDetailActions fileId="file-1" draftNotingId="note-1" status="active" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign note (green)" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Sign note (green)" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(NOTE_SIGN_RECORDS_COPY);
  });
});

describe("no other estab source states a signature level of its own", () => {
  const ROOT = join(process.cwd(), "src", "app", "(app)", "estab");

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it("outside _shared/signatureCopy.ts, no estab source claims DSC e-signing or promises it for 'Phase 2'", () => {
    const offenders = sources(ROOT)
      .filter((f) => !f.endsWith(join("_shared", "signatureCopy.ts")))
      .filter((f) => /DSC e-?sign|e-Sign\/DSC|arrives in Phase 2|records your e-signature/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
