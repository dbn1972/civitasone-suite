import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { EnrollButton } from "./EnrollButton";

function renderButton(props: Partial<Parameters<typeof EnrollButton>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EnrollButton trainingId="training-1" employeeId="emp-1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("EnrollButton — GAP-HR-TRAINING-01", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a linked-record message instead of a button when the viewer has no employee link", () => {
    renderButton({ employeeId: null });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/no linked employee record/i)).toBeInTheDocument();
  });

  it("POSTs {trainingId, employeeId} to /api/proxy/v1/hrms/nominations and shows a success message", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "nom-1", status: "accepted" }), { status: 202 }));

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Enroll me" }));

    await waitFor(() => expect(screen.getByText(/nominated for this programme/i)).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/nominations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ trainingId: "training-1", employeeId: "emp-1" }),
      }),
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows a clerk-safe error and stays enrollable again when the request fails", async () => {
    fetchMock.mockResolvedValue(new Response("hrms-service trace at line 12", { status: 500 }));

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Enroll me" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/hrms-service/);
    expect(screen.getByRole("button", { name: "Enroll me" })).not.toBeDisabled();
  });
});
