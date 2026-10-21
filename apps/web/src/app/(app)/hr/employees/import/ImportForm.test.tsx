import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ImportForm } from "./ImportForm";

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ImportForm />
    </NextIntlClientProvider>,
  );
}

const HEADER = "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n";

const CSV =
  HEADER +
  "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n" +
  "EMP-002,Meena Iyer,,9123456780,NOPE,JC,permanent,2024-02-01,40000,female\n";

function fileOf(csv: string) {
  // jsdom's File shim in this environment doesn't implement .text(), which
  // the review step relies on — patch it on for this one instance rather than
  // changing production code to a less-standard file-reading API.
  const file = new File([csv], "employees.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  return file;
}
function csvFile() {
  return fileOf(CSV);
}

function chooseFile(file: File) {
  const input = document.getElementById("import-csv-file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

/** Step 1 of the two-step flow: pick a file and ask for the review. Nothing is sent. */
function review(file: File = csvFile()) {
  chooseFile(file);
  fireEvent.click(screen.getByRole("button", { name: /review file/i }));
}

/** Step 2: the explicit "Import N valid rows" confirmation. */
async function confirm() {
  fireEvent.click(await screen.findByRole("button", { name: /import \d+ valid rows?/i }));
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
function mockBackend(opts: { bulkPostOk?: boolean; bulkPostBody?: string; bulkPostStatus?: number; mastersOk?: boolean } = {}) {
  const { bulkPostOk = true, bulkPostBody = "{}", bulkPostStatus = 202, mastersOk = true } = opts;
  const postedBodies: { employees: Record<string, unknown>[] }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/proxy/v1/hrms/departments") {
      if (!mastersOk) return { ok: false, status: 500, json: async () => ({}) } as Response;
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
function postedOf(fetchMock: unknown) {
  return (fetchMock as { postedBodies: { employees: Record<string, unknown>[] }[] }).postedBodies;
}

describe("ImportForm — department/designation code resolution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves departmentCode/designationCode to real UUIDs before posting, instead of sending the code as the id", async () => {
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review();
    await confirm();

    // GAP-HR-EMPLOYEES-IMPORT-02: reworded from "imported" to "submitted"
    // -- a 202 here means queued, not yet confirmed written.
    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());

    const posted = postedOf(fetchMock);
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

    review();

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

    review();
    await confirm();

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
      HEADER +
      "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n" +
      "EMP-003,Asha Rao,asha@office.gov.in,9988776655,FIN,JC,permanent,2024-03-01,42000,female\n";

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

    review(fileOf(csv));
    await confirm();

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
      HEADER +
      'EMP-009,"Das, Rashmi Ranjan",das@office.gov.in,9876543211,FIN,JC,permanent,2024-01-15,44900,female\n';

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));
    await confirm();

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    expect(postedOf(fetchMock)[0].employees[0]).toMatchObject({ fullName: "Das, Rashmi Ranjan", employeeNo: "EMP-009" });
  });

  it("keeps a quoted value that contains a line break in one cell instead of splitting the row in two", async () => {
    const csv =
      HEADER +
      'EMP-014,"Rao,\nAsha",asha@office.gov.in,9876543216,FIN,JC,permanent,2024-01-15,44900,female\n';

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));
    await confirm();

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    expect(postedOf(fetchMock)[0].employees[0]).toMatchObject({ fullName: "Rao,\nAsha", employeeNo: "EMP-014" });
  });

  it("refuses a file with a quote that is never closed, and sends nothing", async () => {
    const csv = HEADER + 'EMP-015,"Never closed,asha@office.gov.in,9876543216,FIN,JC,permanent,2024-01-15,44900,female\n';
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));

    expect(await screen.findByText(/a quoted value is opened but never closed/i)).toBeInTheDocument();
    expect(postedOf(fetchMock)).toHaveLength(0);
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
    const csv = HEADER + "EMP-010,Bad Pay,,9876543212,FIN,JC,permanent,2024-01-15,abc,male\n";

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));

    await waitFor(() => expect(screen.getByText(/invalid basic pay/i)).toBeInTheDocument());
    // No valid row => there is nothing to confirm, and nothing was sent.
    expect(screen.getByRole("button", { name: /import 0 valid rows/i })).toBeDisabled();
    expect(postedOf(fetchMock)).toHaveLength(0);
  });

  it("converts a valid decimal basicPay to paise without float rounding error", async () => {
    const csv = HEADER + "EMP-011,Good Pay,,9876543213,FIN,JC,permanent,2024-01-15,44900.50,male\n";

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));
    await confirm();

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    expect(postedOf(fetchMock)[0].employees[0]).toMatchObject({ basicMinor: 4490050 });
  });

  it("flags an invalid date format and never posts that row", async () => {
    const csv = HEADER + "EMP-012,Bad Date,,9876543214,FIN,JC,permanent,15/01/2024,44900,male\n";

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));

    await waitFor(() => expect(screen.getByText(/invalid date/i)).toBeInTheDocument());
    expect(postedOf(fetchMock)).toHaveLength(0);
  });

  it("flags a date that has the right shape but is not a real calendar date", async () => {
    const csv = HEADER + "EMP-016,Feb Thirty,,9876543214,FIN,JC,permanent,2024-02-30,44900,male\n";

    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    review(fileOf(csv));

    expect(await screen.findByText(/invalid date "2024-02-30"/i)).toBeInTheDocument();
  });

  it("flags a second row that repeats an employeeNo from earlier in the file, keeping the first", async () => {
    const csv =
      HEADER +
      "EMP-020,First One,,9876543214,FIN,JC,permanent,2024-01-15,44900,male\n" +
      "EMP-020,Second One,,9876543215,FIN,JC,permanent,2024-01-16,44900,male\n";

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));

    expect(await screen.findByText(/appears more than once in this file \(first on row 2\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import 1 valid row$/i })).toBeInTheDocument();
  });

  it("flags a malformed email or mobile number before anything is sent", async () => {
    const csv = HEADER + "EMP-021,Bad Contact,not-an-email,12ab,FIN,JC,permanent,2024-01-15,44900,male\n";

    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    review(fileOf(csv));

    expect(await screen.findByText(/invalid email address/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid mobile number/i)).toBeInTheDocument();
    // PII: the offending values are never echoed into the page (nor, via it, the error report).
    expect(document.body.textContent).not.toContain("not-an-email");
    expect(document.body.textContent).not.toContain("12ab");
  });

  it("does not blame the person's file when the department/designation lists fail to load", async () => {
    vi.stubGlobal("fetch", mockBackend({ mastersOk: false }));
    renderForm();

    review();

    expect(await screen.findByText(/couldn't load the department and designation lists/i)).toBeInTheDocument();
    expect(screen.queryByText(/unknown department code/i)).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-EMPLOYEES-IMPORT-03 (acceptance: "Preview shows counts and nothing is
 * sent until the user confirms").
 */
describe("ImportForm — preview before import", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the total / valid / skipped counts after review and has sent NOTHING yet", async () => {
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review();

    const status = await screen.findByText(/2 rows read: 1 ready to import, 1 with errors/i);
    expect(status).toHaveAttribute("role", "status");
    expect(screen.getByText(/nothing has been sent yet/i)).toBeInTheDocument();
    // Only the two read-only master lookups have happened; no write.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "/api/proxy/v1/hrms/departments",
      "/api/proxy/v1/hrms/designations",
    ]);
    expect(postedOf(fetchMock)).toHaveLength(0);
    expect(screen.getByRole("button", { name: /import 1 valid row$/i })).toBeEnabled();
  });

  it("posts only after the explicit 'Import N valid rows' click, and only the valid rows", async () => {
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review();
    await screen.findByText(/2 rows read/i);
    expect(postedOf(fetchMock)).toHaveLength(0);

    await confirm();
    await waitFor(() => expect(screen.getByText(/1 submitted, 1 failed/i)).toBeInTheDocument());
    expect(postedOf(fetchMock)).toHaveLength(1);
    expect(postedOf(fetchMock)[0].employees.map((e) => e.employeeNo)).toEqual(["EMP-001"]);
  });

  it("previews at most the first 10 rows of a longer file, and says how many there are in total", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const n = String(i + 1).padStart(3, "0");
      return `EMP-${n},Person ${n},,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n`;
    }).join("");
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(HEADER + rows));

    await screen.findByText(/12 rows read: 12 ready to import, 0 with errors/i);
    const table = screen.getByRole("table");
    // header row + 10 body rows
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText(/showing 10 of 12 rows/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import 12 valid rows/i })).toBeInTheDocument();
  });

  it("marks each previewed row Ready or Will be skipped, and shows pay as a formatted rupee amount", async () => {
    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    review();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("Ready")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("₹44,900.00")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Will be skipped")).toBeInTheDocument();
  });

  it("choosing a different file throws the previous review away", async () => {
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review();
    await screen.findByText(/2 rows read/i);

    chooseFile(fileOf(HEADER));
    expect(screen.queryByText(/2 rows read/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /import \d+ valid rows?/i })).not.toBeInTheDocument();
    expect(postedOf(fetchMock)).toHaveLength(0);
  });

  it("'Choose a different file' cancels the review without sending anything", async () => {
    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review();
    await screen.findByText(/2 rows read/i);
    fireEvent.click(screen.getByRole("button", { name: /choose a different file/i }));

    expect(screen.queryByText(/2 rows read/i)).not.toBeInTheDocument();
    expect(postedOf(fetchMock)).toHaveLength(0);
  });
});

/** GAP-HR-EMPLOYEES-IMPORT-05 */
describe("ImportForm — optional managerEmployeeNo column", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes managerEmployeeNo through to the bulk payload when present", async () => {
    const csv =
      "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender,managerEmployeeNo\n" +
      "EMP-013,New Hire,,9876543215,FIN,JC,permanent,2024-01-15,44900,male,EMP-999\n";

    const fetchMock = mockBackend();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    review(fileOf(csv));
    await confirm();

    await waitFor(() => expect(screen.getByText(/submitted/i)).toBeInTheDocument());
    expect(postedOf(fetchMock)[0].employees[0]).toMatchObject({ managerEmployeeNo: "EMP-999" });
  });
});

/** GAP-HR-EMPLOYEES-IMPORT-06 */
describe("ImportForm — error report download", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers a Download error report button once there is at least one failed row", async () => {
    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    review();

    expect(await screen.findByRole("button", { name: /download error report/i })).toBeInTheDocument();
  });
});

/** GAP-HR-EMPLOYEES-IMPORT-07 (fix step 2): the outcome is announced, not just painted. */
describe("ImportForm — result announcement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the final outcome in a role=status region with plain 'N submitted, M failed' text", async () => {
    vi.stubGlobal("fetch", mockBackend());
    renderForm();

    review();
    await confirm();

    const result = await screen.findByText(/1 submitted, 1 failed/i);
    expect(result).toHaveAttribute("role", "status");
    expect(result.textContent).not.toMatch(/[✅❌⬇]/u);
  });
});
