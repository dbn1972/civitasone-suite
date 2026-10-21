import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ImportForm } from "./ImportForm";

function renderForm(props: React.ComponentProps<typeof ImportForm> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ImportForm {...props} />
    </NextIntlClientProvider>,
  );
}

const CSV =
  "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
  "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n" +
  "EMP-002,Meena Iyer,,9123456780,NOPE,JC,permanent,2024-02-01,40000,female\n";

function csvFile() {
  // jsdom's File shim in this environment doesn't implement .text(), which
  // handleSubmit relies on — patch it on for this one instance rather than
  // changing production code to a less-standard file-reading API.
  const file = new File([CSV], "employees.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => CSV });
  return file;
}

// FINDING-2 (HRMS role-based review): submission moved from one
// POST /api/proxy/v1/hrms/employees call per row to POST
// /api/proxy/v1/hrms/employees/bulk (one call per chunk) — this mock now
// answers the bulk endpoint instead. `bulkPostOk`/`bulkPostStatus`/
// `bulkPostBody` shape a single, whole-request failure (mirroring the old
// `employeePostOk` etc.), which is what a network error or a body the
// server rejected before per-row validation looks like from the form's
// point of view — the per-row-detail (fieldErrors) path has its own
// dedicated test below.
function mockBackend(opts: { bulkPostOk?: boolean; bulkPostBody?: string; bulkPostStatus?: number } = {}) {
  const { bulkPostOk = true, bulkPostBody = "{}", bulkPostStatus = 202 } = opts;
  const postedBodies: { employees: Record<string, unknown>[] }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/proxy/v1/hrms/departments") {
      return { ok: true, json: async () => ({ data: [{ id: "dept-fin-uuid", code: "FIN" }] }) } as Response;
    }
    if (url === "/api/proxy/v1/hrms/designations") {
      return { ok: true, json: async () => ({ data: [{ id: "desig-jc-uuid", code: "JC" }] }) } as Response;
    }
    if (url === "/api/proxy/v1/hrms/employees/bulk" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { employees: Record<string, unknown>[] };
      postedBodies.push(body);
      if (!bulkPostOk) {
        return { ok: false, status: bulkPostStatus, text: async () => bulkPostBody } as Response;
      }
      return { ok: true, status: 202, text: async () => "{}" } as Response;
    }
    return { ok: false, status: 404, text: async () => "not found" } as Response;
  });
  (fn as unknown as { postedBodies: typeof postedBodies }).postedBodies = postedBodies;
  return fn;
}

describe("ImportForm — department/designation code resolution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves departmentCode/designationCode to real UUIDs before posting, instead of sending the code as the id", async () => {
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    // GAP-HR-EMPLOYEES-IMPORT-02: reworded from "imported" to "submitted"
    // -- a 202 here means queued, not yet confirmed written.
    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());

    const posted = (fetchMock as unknown as { postedBodies: { employees: Record<string, unknown>[] }[] }).postedBodies;
    // FINDING-2: one bulk call (not one call per row) carrying only the row
    // with a valid department code — the unknown-code row never reaches the
    // network at all (see the "unknown department code" test below).
    expect(posted).toHaveLength(1);
    expect(posted[0].employees).toHaveLength(1);
    expect(posted[0].employees[0]).toMatchObject({ departmentId: "dept-fin-uuid", designationId: "desig-jc-uuid" });
  });

  it("reports an unknown department code by name instead of sending it as a UUID and getting a bare 400", async () => {
    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => {
      expect(screen.getByText(/unknown department code "NOPE"/i)).toBeInTheDocument();
    });
  });
});

/**
 * UX-016: a failed per-row employee create used to append the raw response
 * text (falling back to `request failed (${res.status})`) straight into the
 * visible error list — the same class of leak useFormError closes
 * fleet-wide (UX-003). Still true after FINDING-2's move to the bulk
 * endpoint: a whole-chunk failure (this test) falls back to the same
 * useFormError-derived, clerk-safe message for every row in the chunk.
 */
describe("ImportForm — UX-016 clerk-safe errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe per-row message, never the raw server text or status, when the bulk call fails with no per-row detail", async () => {
    vi.stubGlobal(
      "fetch",
      mockBackend({ bulkPostOk: false, bulkPostStatus: 500, bulkPostBody: "hrms-service employee-create panicked" }),
    );
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    const errorList = screen.getByText(/couldn't save/i).closest("div");
    expect(errorList?.textContent).not.toMatch(/hrms-service employee-create panicked/);
    expect(errorList?.textContent).not.toMatch(/\b500\b/);
  });

  it("shows a clerk-safe per-row message for exactly the bad row when the bulk call 400s with fieldErrors, and does not blame the other rows in the chunk", async () => {
    // Two valid rows (both FIN/JC) in one chunk; the server's fieldErrors
    // names only the second (index 1) as bad -- e.g. a duplicate employeeNo
    // caught server-side. The row this doesn't name must not be reported as
    // failed, and the retry-without-the-bad-row must actually happen (one
    // more POST, this time succeeding) rather than the whole chunk being
    // silently dropped.
    const csv =
      "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
      "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n" +
      "EMP-003,Asha Rao,asha@office.gov.in,9988776655,FIN,JC,permanent,2024-03-01,42000,female\n";
    const file = new File([csv], "employees.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    let bulkCallCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/proxy/v1/hrms/departments") {
        return { ok: true, json: async () => ({ data: [{ id: "dept-fin-uuid", code: "FIN" }] }) } as Response;
      }
      if (url === "/api/proxy/v1/hrms/designations") {
        return { ok: true, json: async () => ({ data: [{ id: "desig-jc-uuid", code: "JC" }] }) } as Response;
      }
      if (url === "/api/proxy/v1/hrms/employees/bulk" && init?.method === "POST") {
        bulkCallCount++;
        const body = JSON.parse(String(init.body)) as { employees: Record<string, unknown>[] };
        if (bulkCallCount === 1) {
          expect(body.employees).toHaveLength(2);
          return {
            ok: false,
            status: 400,
            text: async () =>
              JSON.stringify({
                code: "VALIDATION_FAILED",
                message: "Bulk import has errors",
                fieldErrors: [{ field: "employees.1.employeeNo", message: "Duplicate: EMP-003" }],
              }),
          } as Response;
        }
        // Retry with the bad row dropped.
        expect(body.employees).toHaveLength(1);
        expect(body.employees[0]).toMatchObject({ employeeNo: "EMP-001" });
        return { ok: true, status: 202, text: async () => "{}" } as Response;
      }
      return { ok: false, status: 404, text: async () => "not found" } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    expect(bulkCallCount).toBe(2);
    expect(screen.getByText(/Asha Rao.*Duplicate: EMP-003/i)).toBeInTheDocument();
    // The good row (Ravi Kumar / EMP-001) must not appear in the failure list.
    expect(screen.queryByText(/Ravi Kumar/i)).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-EMPLOYEES-IMPORT-03: the previous naive `line.split(",")` shifted
 * every later column whenever a value legitimately contained a comma.
 */
describe("ImportForm — RFC 4180 CSV parsing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses a quoted field containing a comma as a single cell, not two", async () => {
    const csv =
      'employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n' +
      'EMP-009,"Das, Rashmi Ranjan",das@office.gov.in,9876543211,FIN,JC,permanent,2024-01-15,44900,female\n';
    const file = new File([csv], "employees.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    const posted = (fetchMock as unknown as { postedBodies: { employees: Record<string, unknown>[] }[] }).postedBodies;
    expect(posted[0].employees[0]).toMatchObject({ fullName: "Das, Rashmi Ranjan", employeeNo: "EMP-009" });
  });
});

/**
 * GAP-HR-EMPLOYEES-IMPORT-03: basicPay used to become NaN -> null on any
 * non-numeric input, silently. Validated client-side now, using the same
 * decimal-safe rupeesToMinorString every money input in this app uses (no
 * `Number(x) * 100` float rounding).
 */
describe("ImportForm — client-side row validation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("flags a non-numeric basicPay and never posts that row", async () => {
    const csv =
      "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
      "EMP-010,Bad Pay,,9876543212,FIN,JC,permanent,2024-01-15,abc,male\n";
    const file = new File([csv], "employees.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/invalid basic pay/i)).toBeInTheDocument());
    const posted = (fetchMock as unknown as { postedBodies: unknown[] }).postedBodies;
    expect(posted).toHaveLength(0);
  });

  it("converts a valid decimal basicPay to paise without float rounding error", async () => {
    const csv =
      "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
      "EMP-011,Good Pay,,9876543213,FIN,JC,permanent,2024-01-15,44900.50,male\n";
    const file = new File([csv], "employees.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    const posted = (fetchMock as unknown as { postedBodies: { employees: Record<string, unknown>[] }[] }).postedBodies;
    expect(posted[0].employees[0]).toMatchObject({ basicMinor: 4490050 });
  });

  it("flags an invalid date format and never posts that row", async () => {
    const csv =
      "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
      "EMP-012,Bad Date,,9876543214,FIN,JC,permanent,15/01/2024,44900,male\n";
    const file = new File([csv], "employees.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/invalid date/i)).toBeInTheDocument());
  });
});

/** GAP-HR-EMPLOYEES-IMPORT-05 */
describe("ImportForm — optional managerEmployeeNo column", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes managerEmployeeNo through to the bulk payload when present", async () => {
    const csv =
      "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender,managerEmployeeNo\n" +
      "EMP-013,New Hire,,9876543215,FIN,JC,permanent,2024-01-15,44900,male,EMP-999\n";
    const file = new File([csv], "employees.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    const posted = (fetchMock as unknown as { postedBodies: { employees: Record<string, unknown>[] }[] }).postedBodies;
    expect(posted[0].employees[0]).toMatchObject({ managerEmployeeNo: "EMP-999" });
  });
});

/** GAP-HR-EMPLOYEES-IMPORT-06 */
describe("ImportForm — error report download", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers a Download error report button once there is at least one failed row", async () => {
    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    expect(await screen.findByRole("button", { name: /download error report/i })).toBeInTheDocument();
  });
});

const TWO_ROW_CSV =
  "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
  "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n" +
  "EMP-003,Asha Rao,asha@office.gov.in,9988776655,FIN,JC,permanent,2024-03-01,42000,female\n";

function fileOf(csv: string) {
  const file = new File([csv], "employees.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  return file;
}

function chooseAndSubmit(csv: string) {
  const input = document.getElementById("import-csv-file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [fileOf(csv)] } });
  fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));
}

const MASTERS = (url: string): Response | null => {
  if (url === "/api/proxy/v1/hrms/departments") return { ok: true, json: async () => ({ data: [{ id: "dept-fin-uuid", code: "FIN" }] }) } as Response;
  if (url === "/api/proxy/v1/hrms/designations") return { ok: true, json: async () => ({ data: [{ id: "desig-jc-uuid", code: "JC" }] }) } as Response;
  return null;
};

/**
 * GAP-HR-EMPLOYEES-IMPORT-01: a 403 is ONE permission message, not one
 * "couldn't save" line per row, and it stops the run.
 */
describe("ImportForm — 403 is a single permission message", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows exactly one permission message for a refused chunk of several rows -- no per-row lines", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const m = MASTERS(url);
      if (m) return m;
      if (url === "/api/proxy/v1/hrms/employees/bulk" && init?.method === "POST") {
        return { ok: false, status: 403, text: async () => JSON.stringify({ code: "FORBIDDEN", message: "role not allowed" }) } as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    chooseAndSubmit(TWO_ROW_CSV);

    expect(await screen.findByText("You don't have permission to import employees.")).toBeInTheDocument();
    expect(screen.getAllByText(/permission to import employees/i)).toHaveLength(1);
    expect(screen.queryByText(/couldn't save/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ravi Kumar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Asha Rao/)).not.toBeInTheDocument();
    // nothing "submitted", no per-row CSV report to download
    expect(screen.queryByText(/submitted/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download error report/i })).not.toBeInTheDocument();
  });

  it("stops after the first refused chunk instead of sending the rest (501 rows = 2 chunks, 1 request)", async () => {
    let bulkCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const m = MASTERS(url);
      if (m) return m;
      if (url === "/api/proxy/v1/hrms/employees/bulk" && init?.method === "POST") {
        bulkCalls++;
        return { ok: false, status: 403, text: async () => "{}" } as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const header = "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n";
    const rows = Array.from({ length: 501 }, (_, i) => `EMP-${i},Person ${i},,,FIN,JC,permanent,2024-01-15,44900,male`).join("\n");
    renderForm();
    chooseAndSubmit(header + rows + "\n");

    expect(await screen.findByText("You don't have permission to import employees.")).toBeInTheDocument();
    expect(bulkCalls).toBe(1);
  });
});

/**
 * GAP-HR-EMPLOYEES-IMPORT-02: "submitted" immediately; "created N" only after
 * the status route says so; failed rows named; never a green check on a 202.
 */
describe("ImportForm — confirms the real outcome through the status route", () => {
  afterEach(() => vi.unstubAllGlobals());

  type StatusReply = { ok: boolean; status: number; body?: unknown };
  function backend(opts: { batchBody?: string; statuses: StatusReply[] | (() => StatusReply) }) {
    const statusCalls: string[] = [];
    let n = 0;
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      const m = MASTERS(url);
      if (m) return m;
      if (url === "/api/proxy/v1/hrms/employees/bulk" && init?.method === "POST") {
        return { ok: true, status: 202, text: async () => opts.batchBody ?? JSON.stringify({ id: "batch-1", status: "accepted" }) } as Response;
      }
      if (url.startsWith("/api/proxy/v1/hrms/employees/bulk/status/")) {
        statusCalls.push(url);
        const r = typeof opts.statuses === "function" ? opts.statuses() : (opts.statuses[Math.min(n++, opts.statuses.length - 1)] as StatusReply);
        return { ok: r.ok, status: r.status, text: async () => JSON.stringify(r.body ?? {}) } as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as Response;
    });
    return Object.assign(fn, { statusCalls });
  }
  const processing = { ok: true, status: 200, body: { batchId: "batch-1", status: "processing", total: 2, created: 1, failed: 0, pending: 1, failedRows: [] } };
  const completedOk = { ok: true, status: 200, body: { batchId: "batch-1", status: "completed", total: 2, created: 2, failed: 0, pending: 0, failedRows: [] } };

  it("says 'submitted' while processing, shows no 'created' yet, and reports 'created' only after completion", async () => {
    const fetchMock = backend({ statuses: [processing, processing, completedOk] });
    vi.stubGlobal("fetch", fetchMock);
    renderForm({ pollIntervalMs: 20, pollMaxMs: 5000 });
    chooseAndSubmit(TWO_ROW_CSV);

    const submitted = await screen.findByText(/2 submitted for creation/i);
    expect(submitted).toBeInTheDocument();
    expect(screen.queryByText(/\d+ created/)).not.toBeInTheDocument();
    // the button is disabled for the whole poll
    expect(screen.getByRole("button", { name: /creating employees/i })).toBeDisabled();

    expect(await screen.findByText("2 created")).toBeInTheDocument();
    expect(fetchMock.statusCalls.length).toBeGreaterThanOrEqual(3);
    expect(fetchMock.statusCalls[0]).toBe("/api/proxy/v1/hrms/employees/bulk/status/batch-1");
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload & import/i })).toBeEnabled();
  });

  it("names a row the server could not create, from the stable failure code, in the list and the CSV report", async () => {
    const failed = {
      ok: true, status: 200,
      body: { batchId: "batch-1", status: "completed", total: 2, created: 1, failed: 1, pending: 0, failedRows: [{ rowNo: 2, employeeNo: "EMP-003", code: "EMPLOYEE_NO_EXISTS" }] },
    };
    vi.stubGlobal("fetch", backend({ statuses: [failed] }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 5000 });
    chooseAndSubmit(TWO_ROW_CSV);

    expect(await screen.findByText("Row 3 (Asha Rao): this employee number already exists")).toBeInTheDocument();
    expect(screen.getByText(/1 created, 1 failed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download error report/i })).toBeInTheDocument();
  });

  it("falls back to a generic reason for an unknown failure code (never the server's own text)", async () => {
    const failed = {
      ok: true, status: 200,
      body: { batchId: "batch-1", status: "completed", total: 2, created: 1, failed: 1, pending: 0, failedRows: [{ rowNo: 1, employeeNo: "EMP-001", code: "SOMETHING_NEW" }] },
    };
    vi.stubGlobal("fetch", backend({ statuses: [failed] }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 5000 });
    chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText("Row 2 (Ravi Kumar): the employee could not be created")).toBeInTheDocument();
  });

  it("never shows a green 'created' when polling times out: it says how many are confirmed and how many are still pending", async () => {
    vi.stubGlobal("fetch", backend({ statuses: () => processing }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 60 });
    chooseAndSubmit(TWO_ROW_CSV);

    expect(await screen.findByText(/2 submitted\. 1 confirmed created so far, 1 still being processed/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ created/)).not.toBeInTheDocument();
  });

  it("does not claim success when the status route cannot find the batch (404)", async () => {
    vi.stubGlobal("fetch", backend({ statuses: () => ({ ok: false, status: 404 }) }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 500 });
    chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText(/2 submitted\. 0 confirmed created so far, 2 still being processed/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ created/)).not.toBeInTheDocument();
  });

  it("keeps polling through a transient status failure and then reports the real result", async () => {
    vi.stubGlobal("fetch", backend({ statuses: [{ ok: false, status: 503 }, completedOk] }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 5000 });
    chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText("2 created")).toBeInTheDocument();
  });

  it("with no batch id in the 202 there is nothing to poll: the result stays 'submitted'", async () => {
    const fetchMock = backend({ batchBody: "{}", statuses: [completedOk] });
    vi.stubGlobal("fetch", fetchMock);
    renderForm({ pollIntervalMs: 5, pollMaxMs: 500 });
    chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText(/^2 submitted$/)).toBeInTheDocument();
    expect(fetchMock.statusCalls).toHaveLength(0);
    expect(screen.queryByText(/created/)).not.toBeInTheDocument();
  });
});
