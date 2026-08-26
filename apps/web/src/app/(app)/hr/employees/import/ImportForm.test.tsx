import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportForm } from "./ImportForm";

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

function mockBackend() {
  const postedBodies: Record<string, unknown>[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/proxy/v1/hrms/departments") {
      return { ok: true, json: async () => ({ data: [{ id: "dept-fin-uuid", code: "FIN" }] }) } as Response;
    }
    if (url === "/api/proxy/v1/hrms/designations") {
      return { ok: true, json: async () => ({ data: [{ id: "desig-jc-uuid", code: "JC" }] }) } as Response;
    }
    if (url === "/api/proxy/v1/hrms/employees" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      postedBodies.push(body);
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
    render(<ImportForm />);

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => expect(screen.getByText(/imported/i)).toBeInTheDocument());

    const posted = (fetchMock as unknown as { postedBodies: Record<string, unknown>[] }).postedBodies;
    expect(posted).toHaveLength(1); // only the row with a valid department code posts
    expect(posted[0]).toMatchObject({ departmentId: "dept-fin-uuid", designationId: "desig-jc-uuid" });
  });

  it("reports an unknown department code by name instead of sending it as a UUID and getting a bare 400", async () => {
    vi.stubGlobal("fetch", mockBackend());
    render(<ImportForm />);

    const input = document.getElementById("import-csv-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /upload & import/i }));

    await waitFor(() => {
      expect(screen.getByText(/unknown department code "NOPE"/i)).toBeInTheDocument();
    });
  });
});
