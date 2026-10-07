import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReportTemplateOption } from "@/app/_data/loaders";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { NewScheduledForm } from "./NewScheduledForm";

const TEMPLATES: ReportTemplateOption[] = [
  { id: "3f2a9c1b-0000-4000-8000-000000000001", name: "Monthly Collection Summary", status: "active" },
  { id: "3f2a9c1b-0000-4000-8000-000000000002", name: "Daily Grievance Digest", status: "active" },
];

describe("NewScheduledForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-REPORTS-SCHEDULED-01: offers a dropdown of template names, no free-typed UUID input", () => {
    render(<NewScheduledForm templates={TEMPLATES} />);
    const select = screen.getByLabelText("Report template") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Monthly Collection Summary" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Daily Grievance Digest" })).toBeInTheDocument();
    // The old UUID-pattern text input is gone.
    expect(screen.queryByPlaceholderText("UUID of report template")).not.toBeInTheDocument();
  });

  it("disables submission when there are no templates", () => {
    render(<NewScheduledForm templates={[]} />);
    expect(screen.getByRole("button", { name: /Create Schedule/ })).toBeDisabled();
    expect(screen.getByText("No report templates available")).toBeInTheDocument();
  });

  it("GAP-REPORTS-SCHEDULED-02/03: posts to the /api/proxy/v1 prefix and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-id" } }), { status: 202 }),
    );
    render(<NewScheduledForm templates={TEMPLATES} />);

    fireEvent.change(screen.getByLabelText("Report template"), { target: { value: TEMPLATES[0]!.id } });
    fireEvent.change(screen.getByLabelText(/Recipients/), { target: { value: "ops@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Schedule/ }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/reports/scheduled");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      templateId: TEMPLATES[0]!.id,
      cadence: "daily",
      recipients: ["ops@example.com"],
      format: "pdf",
    });
    expect(screen.getByText("Scheduled report created.")).toBeInTheDocument();
  });
});
