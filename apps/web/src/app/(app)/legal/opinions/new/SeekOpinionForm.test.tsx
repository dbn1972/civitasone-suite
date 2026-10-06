import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock("@/lib/useFormError", () => ({
  useFormError: () => ({ fromResponse: async () => ({ message: "failed" }) }),
}));

import { SeekOpinionForm } from "./SeekOpinionForm";

function fillAndSubmit(subject = "Tender dispute", question = "Can we cancel the tender?") {
  fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText(/Question/i), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /Submit request/i }));
}

describe("SeekOpinionForm (GAP-LEGAL-OPINIONS-NEW-01 / NEW-02)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("posts to the real opinions endpoint and redirects to the created detail page", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "new-op-7" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SeekOpinionForm />);
    fillAndSubmit();
    // confirm dialog
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/legal/opinions"); // NOT /notices
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.subject).toBe("Tender dispute");
    expect(body.question).toBe("Can we cancel the tender?");
    // NEW-02: no client-generated reference sent when the field is blank
    expect(body).not.toHaveProperty("opinionNo");
    expect(body).not.toHaveProperty("noticeNo");

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/legal/opinions/new-op-7"));
  });

  it("sends a user-typed reference as opinionNo, never a Math.random value", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SeekOpinionForm />);
    fireEvent.change(screen.getByLabelText(/Reference no/i), { target: { value: "OPN/2026/0009" } });
    fillAndSubmit();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.opinionNo).toBe("OPN/2026/0009");
  });

  it("blocks submit without a subject and question", () => {
    render(<SeekOpinionForm />);
    fireEvent.click(screen.getByRole("button", { name: /Submit request/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
  });
});
