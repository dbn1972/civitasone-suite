import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { EstabApprovalsPanel } from "./EstabApprovalsPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function tasksPage(data: unknown[], hasMore: boolean): Response {
  return jsonResponse({ data, pagination: { hasMore } });
}

function estabTask(id: string, refId: string, name = "DS approval") {
  return { id, name, status: "pending", refType: "estab_file", refId, roleRef: "estab_deputy_secretary" };
}

function otherTask(id: string) {
  return { id, name: "Leave", status: "pending", refType: "leave_app", refId: `l-${id}` };
}

describe("EstabApprovalsPanel — truthful states (L3)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a real error with retry (NOT 'No approvals pending') when the queue fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500));
    render(<EstabApprovalsPanel />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No approvals pending")).toBeNull();
  });

  it("shows 'No approvals pending' only on a genuine empty success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(tasksPage([], false));
    render(<EstabApprovalsPanel />);
    await screen.findByText("No approvals pending");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("EstabApprovalsPanel — pagination (GAP-ESTAB-APPROVALS-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("pages past a full page of other-module tasks to find estab tasks on page 2", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => otherTask(`o${i}`));
    const estab = estabTask("t-1", "11111111-1111-4111-8111-111111111111");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tasksPage(page1, true))              // page 1: all other modules, hasMore
      .mockResolvedValueOnce(tasksPage([estab], false))          // page 2: the estab task
      .mockResolvedValueOnce(jsonResponse({ data: { fileNo: "EST/2026/9", subject: "Posting order" } })); // file meta

    render(<EstabApprovalsPanel />);
    // The estab file number appears (not an empty state).
    await waitFor(() => expect(screen.getByText("EST/2026/9")).toBeInTheDocument());
    expect(screen.queryByText("No approvals pending")).toBeNull();
  });
});

describe("EstabApprovalsPanel — file context in rows & dialog (GAP-ESTAB-APPROVALS-03)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows file number + subject and names the file in the approve dialog", async () => {
    const estab = estabTask("t-9", "22222222-2222-4222-8222-222222222222");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tasksPage([estab], false))
      .mockResolvedValueOnce(jsonResponse({ data: { fileNo: "EST/2026/42", subject: "Transfer of Shri X" } }));

    render(<EstabApprovalsPanel />);
    await waitFor(() => expect(screen.getByText("EST/2026/42")).toBeInTheDocument());
    expect(screen.getByText("Transfer of Shri X")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/EST\/2026\/42/);
    expect(dialog.textContent).toMatch(/Transfer of Shri X/);
  });
});

describe("EstabApprovalsPanel — honest signature copy (GAP-ESTAB-APPROVALS-02)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("never claims DSC e-Sign in the dialog or button", async () => {
    const estab = estabTask("t-3", "33333333-3333-4333-8333-333333333333");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tasksPage([estab], false))
      .mockResolvedValueOnce(jsonResponse({ data: { fileNo: "EST/1", subject: "S" } }));

    render(<EstabApprovalsPanel />);
    await waitFor(() => expect(screen.getByText("EST/1")).toBeInTheDocument());
    expect(screen.queryByText(/e-Sign/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).not.toMatch(/DSC e-sign|e-Signed/i);
    expect(dialog.textContent).toMatch(/not applied/i);
  });
});

describe("EstabApprovalsPanel — decision message & errors (GAP-ESTAB-APPROVALS-05/06)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("records a neutral 'Approval recorded' message (no 'final'/'forwarded' guess) that can be dismissed", async () => {
    const estab = estabTask("t-5", "44444444-4444-4444-8444-444444444444", "Deputy Secretary approval");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tasksPage([estab], false))
      .mockResolvedValueOnce(jsonResponse({ data: { fileNo: "EST/2026/55", subject: "Sub" } }))
      .mockResolvedValueOnce(jsonResponse({ id: "t-5", status: "accepted" }, 202)) // complete
      .mockResolvedValueOnce(tasksPage([], false)); // reload

    render(<EstabApprovalsPanel />);
    await waitFor(() => expect(screen.getByText("EST/2026/55")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    const reason = dialog.querySelector("textarea") ?? dialog.querySelector("input");
    fireEvent.change(reason!, { target: { value: "Approved as per rules" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve");
    fireEvent.click(confirm!);

    await waitFor(() => expect(screen.getByText(/Approval recorded/i)).toBeInTheDocument());
    expect(screen.queryByText(/final approval/i)).toBeNull();
    expect(screen.queryByText(/forwarded to next level/i)).toBeNull();
    // Dismissible.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(/Approval recorded/i)).toBeNull());
  });

  it("surfaces a clerk-safe error (not raw body) when completion fails", async () => {
    const estab = estabTask("t-7", "55555555-5555-4555-8555-555555555555");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tasksPage([estab], false))
      .mockResolvedValueOnce(jsonResponse({ data: { fileNo: "EST/7", subject: "S" } }))
      .mockResolvedValueOnce(new Response("workflow internal explosion", { status: 500 }));

    render(<EstabApprovalsPanel />);
    await waitFor(() => expect(screen.getByText("EST/7")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    const reason = dialog.querySelector("textarea") ?? dialog.querySelector("input");
    fireEvent.change(reason!, { target: { value: "ok" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve");
    fireEvent.click(confirm!);
    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/workflow internal explosion/);
  });
});
