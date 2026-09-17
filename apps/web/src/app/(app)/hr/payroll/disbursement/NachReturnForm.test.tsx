import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { NachReturnForm } from "./NachReturnForm";

const runs = [{ id: "run-1", payPeriod: "2026-07" }];

// UX-017: NachReturnForm now reads its copy through next-intl
// (useTranslations("nachReturnForm")), so every render needs a real
// provider in the tree.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NachReturnForm runs={runs} />
    </NextIntlClientProvider>,
  );
}

describe("NachReturnForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires return file content before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByText("Process Return File"));
    expect(screen.getByText(/paste the NACH return file content/)).toBeInTheDocument();
  });

  it("processes a return file on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { credited: 8, returned: 1, unmatched: 0 } }), { status: 202 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/Return File Content/), { target: { value: "0001CREDIT" } });
    fireEvent.click(screen.getByText("Process Return File"));

    await waitFor(() => expect(screen.getByText("Process this NACH return file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Process file"));

    await waitFor(() => {
      expect(screen.getByText("Processed: 8 credited, 1 returned, 0 unmatched.")).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/Return File Content/), { target: { value: "bad-content" } });
    fireEvent.click(screen.getByText("Process Return File"));

    await waitFor(() => expect(screen.getByText("Process this NACH return file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Process file"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
