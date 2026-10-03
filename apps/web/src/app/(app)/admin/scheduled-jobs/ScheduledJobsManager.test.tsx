import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScheduledJobsManager, QUEUED_RELOAD_DELAY_MS } from "./ScheduledJobsManager";
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
    // GAP-ADMIN-SCHEDULED-JOBS-01: a reason is mandatory for delete, and is what the server audits.
    const confirm = screen.getByRole("button", { name: "Delete job" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mutations()).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "obsolete export" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(String((mutations()[0]![1] as RequestInit).method)).toBe("DELETE");
    expect(JSON.parse((mutations()[0]![1] as RequestInit).body as string)).toEqual({ reason: "obsolete export" });
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
    // an ordinary target: no reason needed, none sent
    expect((mutations()[0]![1] as RequestInit).body).toBeUndefined();
  });

  it("Run now on a finance/hrms/audit job requires a reason and sends it", async () => {
    render(<ScheduledJobsManager initialJobs={[{ ...job, targetService: "finance-service", targetCommand: "finance.report.generate" }]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Run Payroll export now" }));
    const confirm = await screen.findByRole("button", { name: "Run now" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "month-end re-run" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(JSON.parse((mutations()[0]![1] as RequestInit).body as string)).toEqual({ reason: "month-end re-run" });
  });

  it("disabling goes through /pause and carries an optional reason", async () => {
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByLabelText("Toggle Payroll export").querySelector("input")!);
    const confirm = await screen.findByRole("button", { name: "Disable job" });
    expect(confirm).not.toBeDisabled(); // reason optional
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "freeze for audit" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(String(mutations()[0]![0])).toContain("/job-1/pause");
    expect(JSON.parse((mutations()[0]![1] as RequestInit).body as string)).toEqual({ reason: "freeze for audit" });
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
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "obsolete export" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Delete job "Payroll export"\?/)).toBeInTheDocument();
  });
});

// GAP-ADMIN-SCHEDULED-JOBS-03/-04/-05/-06
describe("ScheduledJobsManager - reload failures, history errors, layout, copy", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  const disabledJob: AdminScheduledJob = { ...job, enabled: false };

  function route(handlers: Record<string, () => Response | Promise<Response>>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const key = `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(input).replace("/api/proxy/v1/admin/scheduled-jobs", "")}`;
      const h = handlers[key];
      if (!h) throw new Error(`unexpected ${key}`);
      return h();
    });
  }

  it("a toggle that succeeded but whose reload fails still shows the new state and tells the operator", async () => {
    route({
      "PUT /job-1": () => new Response("{}", { status: 200 }),
      "GET ": () => new Response("{}", { status: 500 }),
    });
    render(<ScheduledJobsManager initialJobs={[disabledJob]} source="api" />);
    fireEvent.click(screen.getByLabelText("Toggle Payroll export"));
    await waitFor(() => expect(screen.getByLabelText("Toggle Payroll export").querySelector("input")).toBeChecked());
    expect(await screen.findByRole("alert")).toHaveTextContent(/saved, but the list could not be reloaded/i);
  });

  it("a delete whose reload throws removes the row and shows the alert", async () => {
    route({
      "DELETE /job-1": () => new Response("{}", { status: 200 }),
      "GET ": () => { throw new Error("network"); },
    });
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByLabelText("Delete Payroll export"));
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "obsolete export" } });
    fireEvent.click(screen.getByRole("button", { name: /delete job/i }));
    await waitFor(() => expect(screen.queryByText("Payroll export")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reloaded/i);
  });

  it("a reload that returns a bare array updates the list", async () => {
    route({
      "PUT /job-1": () => new Response("{}", { status: 200 }),
      "GET ": () => new Response(JSON.stringify([{ ...job, name: "Renamed on server", enabled: false }]), { status: 200 }),
    });
    render(<ScheduledJobsManager initialJobs={[disabledJob]} source="api" />);
    fireEvent.click(screen.getByLabelText("Toggle Payroll export"));
    expect(await screen.findByText("Renamed on server")).toBeInTheDocument();
  });

  it("history GET 500 shows an error with Retry, not 'No execution history'; retry success shows rows", async () => {
    let calls = 0;
    route({
      "GET /job-1/history": () => {
        calls++;
        return calls === 1
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify({ data: [{ id: "r1", jobId: "job-1", startedAt: "2026-10-01T00:00:00.000Z", completedAt: null, durationMs: 2500, status: "success", errorMessage: null }] }), { status: 200 });
      },
    });
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText("No execution history available.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("2.5s")).toBeInTheDocument();
  });

  it("history 200 with [] shows the empty message", async () => {
    route({ "GET /job-1/history": () => new Response(JSON.stringify({ data: [] }), { status: 200 }) });
    render(<ScheduledJobsManager initialJobs={[job]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(await screen.findByText("No execution history available.")).toBeInTheDocument();
  });

  it("the history panel never exceeds the viewport and keeps no inline animation", async () => {
    route({
      "GET /job-1/history": () => new Response(JSON.stringify({ data: [{ id: "r1", jobId: "job-1", startedAt: "2026-10-01T00:00:00.000Z", completedAt: null, durationMs: null, status: "running", errorMessage: null }] }), { status: 200 }),
    });
    const { container } = render(<ScheduledJobsManager initialJobs={[{ ...job, lastRunStatus: "running" }]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    await screen.findByRole("table", { name: "Execution history" });
    const panel = Array.from(container.querySelectorAll<HTMLElement>("div")).find((d) => d.style.position === "fixed")!;
    expect(panel.style.width).toBe("min(480px, 100vw)");
    expect(panel.style.maxWidth).toBe("100vw");
    expect(screen.getByRole("table", { name: "Execution history" }).parentElement!.style.overflowX).toBe("auto");
    expect(container.innerHTML).not.toMatch(/animation/);
  });

  it("schedule text carries AM/PM and never prints garbage for step expressions", () => {
    render(<ScheduledJobsManager initialJobs={[job, { ...job, id: "job-2", name: "Frequent", cronExpression: "*/30 * * * *" }]} source="api" />);
    expect(screen.getByText("Every day at 08:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Every 30 minutes")).toBeInTheDocument();
    expect(screen.queryByText(/\*:/)).not.toBeInTheDocument();
  });

  it("a failed load does not say 'Create one to get started'", () => {
    render(<ScheduledJobsManager initialJobs={[]} source="error" />);
    expect(screen.queryByText(/create one to get started/i)).not.toBeInTheDocument();
    expect(screen.getByText(/could not load scheduled jobs/i)).toBeInTheDocument();
  });

  it("a 202 (queued) change is kept, announced, and the reload waits so a stale read cannot overwrite it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let gets = 0;
      route({
        "PUT /job-1": () => new Response("{}", { status: 202 }),
        "GET ": () => { gets++; return new Response(JSON.stringify({ data: [{ ...job, enabled: true }] }), { status: 200 }); },
      });
      render(<ScheduledJobsManager initialJobs={[disabledJob]} source="api" />);
      fireEvent.click(screen.getByLabelText("Toggle Payroll export"));
      expect(await screen.findByText(/change queued/i)).toBeInTheDocument();
      expect(gets).toBe(0);
      expect(screen.getByLabelText("Toggle Payroll export").querySelector("input")).toBeChecked();
      await vi.advanceTimersByTimeAsync(QUEUED_RELOAD_DELAY_MS + 50);
      await waitFor(() => expect(gets).toBe(1));
      await waitFor(() => expect(screen.queryByText(/change queued/i)).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});

// GAP-ADMIN-SCHEDULED-JOBS-02
describe("ScheduledJobsManager create form targets", () => {
  const targets = {
    services: [
      { service: "finance-service", commandPrefix: "finance.", sensitive: true, allowList: ["finance\\.report\\..+"], schedulable: true },
      { service: "audit-service", commandPrefix: "audit.", sensitive: true, allowList: null, schedulable: false },
      { service: "report-service", commandPrefix: "report.", sensitive: false, allowList: null, schedulable: true },
    ],
    commandFormat: "service.entity.action", payloadMaxChars: 10000,
  };
  beforeEach(() => { vi.restoreAllMocks(); });

  it("offers only the services the server allows, and refuses a foreign-namespace command before any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 202 }));
    render(<ScheduledJobsManager initialJobs={[]} source="api" targets={targets} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Create Job" }));
    const select = screen.getByLabelText("Target Service") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value).filter(Boolean)).toEqual(["finance-service", "audit-service", "report-service"]);
    // a sensitive service with no allow-list is visible but cannot be chosen
    expect(screen.getByRole("option", { name: "audit-service (allow-list required)" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "finance-service" })).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Evil" } });
    fireEvent.change(screen.getByLabelText("Cron Expression"), { target: { value: "0 8 * * *" } });
    fireEvent.change(select, { target: { value: "report-service" } });
    fireEvent.change(screen.getByLabelText("Target Command"), { target: { value: "finance.payment.release" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('must start with "report."');
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });

  it("a command in the right namespace is sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 202 }));
    render(<ScheduledJobsManager initialJobs={[]} source="api" targets={targets} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Create Job" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Daily report" } });
    fireEvent.change(screen.getByLabelText("Cron Expression"), { target: { value: "0 8 * * *" } });
    fireEvent.change(screen.getByLabelText("Target Service"), { target: { value: "report-service" } });
    fireEvent.change(screen.getByLabelText("Target Command"), { target: { value: "report.generate.daily" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({ targetService: "report-service", targetCommand: "report.generate.daily" });
  });
});
