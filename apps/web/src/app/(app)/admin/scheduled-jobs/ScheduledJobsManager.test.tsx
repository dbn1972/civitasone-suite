import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScheduledJobsManager } from "./ScheduledJobsManager";
import type { AdminScheduledJob } from "@/app/_data/loaders";

const job: AdminScheduledJob = {
  id: "job-1", name: "Payroll export", description: "", cronExpression: "0 8 * * *", timezone: "Asia/Kolkata",
  targetService: "payroll", targetCommand: "payroll.export", payload: {}, enabled: true,
  lastRunAt: null, lastRunStatus: "never_run", nextRunAt: null,
};

// GAP-ADMIN-SCHEDULED-JOBS-01
describe("ScheduledJobsManager confirmations", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [job] }), { status: 200 }));
  });
  const mutations = () => fetchSpy.mock.calls.filter(([, init]) => ["DELETE", "POST", "PUT"].includes(String((init as RequestInit | undefined)?.method)));

  it("Delete opens a dialog and sends nothing until confirmed", async () => {
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Payroll export" }));
    expect(await screen.findByText(/Delete job "Payroll export"\?/)).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(String((mutations()[0]![1] as RequestInit).method)).toBe("DELETE");
  });

  it("Cancel closes the dialog without any request", async () => {
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Run Payroll export now" }));
    expect(await screen.findByText(/This immediately sends payroll/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/This immediately sends payroll/)).not.toBeInTheDocument());
    expect(mutations()).toHaveLength(0);
  });

  it("Run now only fires the run-now endpoint after Confirm", async () => {
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Run Payroll export now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(String(mutations()[0]![0])).toContain("/job-1/run-now");
  });

  it("disabling an enabled job asks first", async () => {
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByLabelText("Toggle Payroll export").querySelector("input")!);
    expect(await screen.findByText(/Disable job "Payroll export"\?/)).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });

  it("keeps the dialog open with an error when the server refuses", async () => {
    fetchSpy.mockImplementation(async (_u, init) =>
      String((init as RequestInit | undefined)?.method) === "DELETE" ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ data: [job] }), { status: 200 }));
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Payroll export" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete job" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Delete job "Payroll export"\?/)).toBeInTheDocument();
  });
});
