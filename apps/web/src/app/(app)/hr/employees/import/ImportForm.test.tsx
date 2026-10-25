import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ImportForm } from "./ImportForm";

function renderForm(props: React.ComponentProps<typeof ImportForm> = {}, opts: { strict?: boolean } = {}) {
  const form = (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ImportForm {...props} />
    </NextIntlClientProvider>
  );
  // next.config sets reactStrictMode: true, so `next dev` mounts every effect twice (mount, cleanup, mount).
  return render(opts.strict ? <StrictMode>{form}</StrictMode> : form);
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

const TWO_ROW_CSV =
  "employeeNo,fullName,email,mobile,departmentCode,designationCode,employeeType,dateOfJoining,basicPay,gender\n" +
  "EMP-001,Ravi Kumar,ravi@office.gov.in,9876543210,FIN,JC,permanent,2024-01-15,44900,male\n" +
  "EMP-003,Asha Rao,asha@office.gov.in,9988776655,FIN,JC,permanent,2024-03-01,42000,female\n";

/**
 * Pick the file, ask for the review, then give the explicit "Import N valid rows"
 * confirmation -- the import is a two-step flow (GAP-HR-EMPLOYEES-IMPORT-03), so
 * everything the status/403 tests below assert starts from a confirmed import.
 */
async function chooseAndSubmit(csv: string) {
  review(fileOf(csv));
  await confirm();
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
    await chooseAndSubmit(TWO_ROW_CSV);

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
    await chooseAndSubmit(header + rows + "\n");

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
    await chooseAndSubmit(TWO_ROW_CSV);

    const submitted = await screen.findByText(/2 submitted for creation/i);
    expect(submitted).toBeInTheDocument();
    expect(screen.queryByText(/\d+ created/)).not.toBeInTheDocument();
    // the button is disabled for the whole poll
    expect(screen.getByRole("button", { name: /creating employees/i })).toBeDisabled();

    expect(await screen.findByText("2 created")).toBeInTheDocument();
    expect(fetchMock.statusCalls.length).toBeGreaterThanOrEqual(3);
    expect(fetchMock.statusCalls[0]).toBe("/api/proxy/v1/hrms/employees/bulk/status/batch-1");
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review file/i })).toBeEnabled();
  });

  // next.config sets reactStrictMode: true, so in `next dev` React mounts, cleans up and mounts again.
  // A guard that only ever flips to "unmounted" in its cleanup stays true after that second mount, the
  // poll loop bails after its first round, and the form sits in "processing" forever.
  it("under React StrictMode the poll still runs to completion: 'created' is reported and the button is re-enabled", async () => {
    const fetchMock = backend({ statuses: [processing, processing, completedOk] });
    vi.stubGlobal("fetch", fetchMock);
    renderForm({ pollIntervalMs: 20, pollMaxMs: 5000 }, { strict: true });
    await chooseAndSubmit(TWO_ROW_CSV);

    expect(await screen.findByText(/2 submitted for creation/i)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ created/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /creating employees/i })).toBeDisabled();

    expect(await screen.findByText("2 created")).toBeInTheDocument();
    expect(fetchMock.statusCalls.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review file/i })).toBeEnabled();
  });

  it("stops polling once the form is really unmounted (guard still works after the StrictMode fix)", async () => {
    const fetchMock = backend({ statuses: () => processing });
    vi.stubGlobal("fetch", fetchMock);
    const view = renderForm({ pollIntervalMs: 20, pollMaxMs: 5000 }, { strict: true });
    await chooseAndSubmit(TWO_ROW_CSV);
    await screen.findByText(/2 submitted for creation/i);
    view.unmount();
    const callsAtUnmount = fetchMock.statusCalls.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(fetchMock.statusCalls.length).toBeLessThanOrEqual(callsAtUnmount + 1);
  });

  it("names a row the server could not create, from the stable failure code, in the list and the CSV report", async () => {
    const failed = {
      ok: true, status: 200,
      body: { batchId: "batch-1", status: "completed", total: 2, created: 1, failed: 1, pending: 0, failedRows: [{ rowNo: 2, employeeNo: "EMP-003", code: "EMPLOYEE_NO_EXISTS" }] },
    };
    vi.stubGlobal("fetch", backend({ statuses: [failed] }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 5000 });
    await chooseAndSubmit(TWO_ROW_CSV);

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
    await chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText("Row 2 (Ravi Kumar): the employee could not be created")).toBeInTheDocument();
  });

  it("never shows a green 'created' when polling times out: it says how many are confirmed and how many are still pending", async () => {
    vi.stubGlobal("fetch", backend({ statuses: () => processing }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 60 });
    await chooseAndSubmit(TWO_ROW_CSV);

    expect(await screen.findByText(/2 submitted\. 1 confirmed created so far, 1 still being processed/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ created/)).not.toBeInTheDocument();
  });

  // CLOS3-S2-04: a status fetch that never answers used to block the deadline check forever (Promise.all over a
  // hung request), leaving the form in "processing". Each status request now carries a timeout signal bounded by
  // the remaining poll budget, so a hang is a transient failure and the loop reaches the deadline.
  it("a status request that never answers is aborted at the poll budget: the form leaves 'processing' and reports unconfirmed", async () => {
    const hung = vi.fn(async (url: string, init?: RequestInit) => {
      const m = MASTERS(url);
      if (m) return m;
      if (url === "/api/proxy/v1/hrms/employees/bulk" && init?.method === "POST") {
        return { ok: true, status: 202, text: async () => JSON.stringify({ id: "batch-1", status: "accepted" }) } as Response;
      }
      if (url.startsWith("/api/proxy/v1/hrms/employees/bulk/status/")) {
        // Hangs forever unless the caller supplied a signal that later aborts.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return { ok: false, status: 404, text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", hung);
    renderForm({ pollIntervalMs: 5, pollMaxMs: 150 });
    await chooseAndSubmit(TWO_ROW_CSV);

    expect(await screen.findByText(/2 submitted\. 0 confirmed created so far, 2 still being processed/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ created/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review file/i })).toBeEnabled();
  });

  it("does not claim success when the status route cannot find the batch (404)", async () => {
    vi.stubGlobal("fetch", backend({ statuses: () => ({ ok: false, status: 404 }) }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 500, notRecordedGraceMs: 0 });
    await chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText(/2 submitted\. 0 confirmed created so far, 2 still being processed/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ created/)).not.toBeInTheDocument();
  });

  it("a 404 right after the 202 means 'not recorded yet' (the batch is written by a queue consumer): keeps polling and then reports the real result", async () => {
    const fetchMock = backend({ statuses: [{ ok: false, status: 404 }, { ok: false, status: 404 }, completedOk] });
    vi.stubGlobal("fetch", fetchMock);
    renderForm({ pollIntervalMs: 5, pollMaxMs: 5000 });
    await chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText("2 created")).toBeInTheDocument();
    expect(fetchMock.statusCalls).toHaveLength(3);
  });

  it("a batch that is still 404 once the grace has passed is given up on (unconfirmed, never a green 'created') without polling to the deadline", async () => {
    const fetchMock = backend({ statuses: () => ({ ok: false, status: 404 }) });
    vi.stubGlobal("fetch", fetchMock);
    renderForm({ pollIntervalMs: 5, pollMaxMs: 5000, notRecordedGraceMs: 30 });
    await chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText(/2 submitted\. 0 confirmed created so far, 2 still being processed/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ created/)).not.toBeInTheDocument();
    expect(fetchMock.statusCalls.length).toBeLessThan(200);
  });

  it("keeps polling through a transient status failure and then reports the real result", async () => {
    vi.stubGlobal("fetch", backend({ statuses: [{ ok: false, status: 503 }, completedOk] }));
    renderForm({ pollIntervalMs: 5, pollMaxMs: 5000 });
    await chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText("2 created")).toBeInTheDocument();
  });

  it("with no batch id in the 202 there is nothing to poll: the result stays 'submitted'", async () => {
    const fetchMock = backend({ batchBody: "{}", statuses: [completedOk] });
    vi.stubGlobal("fetch", fetchMock);
    renderForm({ pollIntervalMs: 5, pollMaxMs: 500 });
    await chooseAndSubmit(TWO_ROW_CSV);
    expect(await screen.findByText(/^2 submitted$/)).toBeInTheDocument();
    expect(fetchMock.statusCalls).toHaveLength(0);
    expect(screen.queryByText(/created/)).not.toBeInTheDocument();
  });
});
