import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/test-utils/intl-render";

import { HeldFilesNotice } from "./HeldFilesNotice";

const EMP = "11111111-1111-4111-8111-111111111111";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GAP-ESTAB-OPERATORS-03: deactivate dialog states how many files the officer holds", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("Given an officer holding 3 files, Then it says so, links to Handover, and asks the held-count endpoint for that officer", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ officerId: EMP, count: 3 }));
    render(<HeldFilesNotice employeeId={EMP} />);
    await waitFor(() => expect(screen.getByTestId("held-files-notice").textContent).toMatch(/holds 3 files/));
    expect(screen.getByRole("link", { name: "Open Handover" })).toHaveAttribute("href", "/estab/handover");
    expect(String(spy.mock.calls[0]![0])).toContain(`/estab/files/held-count?officerId=${EMP}`);
  });

  it("Given an officer holding none, Then the dialog is unchanged apart from saying none are held (no handover link)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ officerId: EMP, count: 0 }));
    render(<HeldFilesNotice employeeId={EMP} />);
    await waitFor(() => expect(screen.getByTestId("held-files-notice").textContent).toMatch(/holds no files/));
    expect(screen.queryByRole("link", { name: "Open Handover" })).not.toBeInTheDocument();
  });

  it("Given the count cannot be fetched, Then it says so honestly instead of implying zero", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ message: "boom" }, 500));
    render(<HeldFilesNotice employeeId={EMP} />);
    await waitFor(() => expect(screen.getByTestId("held-files-notice").textContent).toMatch(/could not check/));
    expect(screen.getByTestId("held-files-notice").textContent).not.toMatch(/holds no files/);
  });
});
