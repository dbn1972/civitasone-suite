import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

    await waitFor(() => expect(screen.getByText(/imported/i)).toBeInTheDocument());

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

    await waitFor(() => expect(screen.getByText(/imported/i)).toBeInTheDocument());
    expect(bulkCallCount).toBe(2);
    expect(screen.getByText(/Asha Rao.*Duplicate: EMP-003/i)).toBeInTheDocument();
    // The good row (Ravi Kumar / EMP-001) must not appear in the failure list.
    expect(screen.queryByText(/Ravi Kumar/i)).not.toBeInTheDocument();
  });
});
