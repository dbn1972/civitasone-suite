import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// GAP-HR-APAR-NEW-02/NEW-05: the form now uses the shared EntityPicker over
// searchEmployees/resolveEmployees (GAP-HR-SF-06) instead of a one-shot
// limit=200 fetch with a raw-UUID-input fallback. Mocked at the adapter
// boundary -- same convention as every other EntityPicker-driven form's
// tests in this codebase (see e.g. hr/employees/[id]/edit/
// EditEmployeeForm.test.tsx) -- rather than simulating the proxy route's
// querystring.
const EMPLOYEES = [
  { id: "550e8400-e29b-41d4-a716-446655440000", label: "Alice Appraisee (E100)" },
  { id: "550e8400-e29b-41d4-a716-446655440001", label: "Bob Reporting (E101)" },
  { id: "550e8400-e29b-41d4-a716-446655440002", label: "Carol Reviewing (E102)" },
  { id: "550e8400-e29b-41d4-a716-446655440003", label: "Dave Accepting (E103)" },
];
const searchEmployeesMock = vi.fn(async (q: string, _signal?: AbortSignal) =>
  EMPLOYEES.filter((e) => e.label.toLowerCase().includes(q.toLowerCase())),
);
const resolveEmployeesMock = vi.fn(async (_ids: string[]) => [] as typeof EMPLOYEES);
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: (q: string, signal: AbortSignal) => searchEmployeesMock(q, signal),
  resolveEmployees: (ids: string[]) => resolveEmployeesMock(ids),
}));

// GAP-HR-APAR-NEW-01: the form body, unchanged apart from the rename.
import AparNewForm, { aparNewSchema } from "./AparNewForm";

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AparNewForm />
    </NextIntlClientProvider>,
  );
}

/** Drives one EntityPicker exactly like EntityPicker.test.tsx's own pattern: type, wait for the option, mousedown it. */
async function pickEmployee(fieldLabel: string, personLabel: string) {
  // { exact: false }: every picker here is a `required` Field, whose label
  // renders a trailing " *" marker (Field.tsx) -- substring matching on the
  // plain field name, same as the regex queries the pre-rewrite version of
  // this file used for the same reason.
  const input = screen.getByLabelText(fieldLabel, { exact: false });
  fireEvent.change(input, { target: { value: personLabel.slice(0, 4) } });
  const option = await screen.findByText(personLabel);
  fireEvent.mouseDown(option);
}

async function fillAndSubmit() {
  await pickEmployee("Employee", "Alice Appraisee (E100)");
  await pickEmployee("Reporting Officer", "Bob Reporting (E101)");
  await pickEmployee("Reviewing Officer", "Carol Reviewing (E102)");
  await pickEmployee("Accepting Authority", "Dave Accepting (E103)");
  fireEvent.click(screen.getByRole("button", { name: /initiate apar/i }));
}

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Error ${res.status}`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("AparNewForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    searchEmployeesMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when initiation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderForm();
    await fillAndSubmit();

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "employeeId", message: "Employee not found." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    renderForm();
    await fillAndSubmit();

    expect(await screen.findByText("Employee not found.")).toBeInTheDocument();
  });

  it("GAP-HR-APAR-NEW-04: the period field is a closed set of FY-formatted options, never free text", async () => {
    renderForm();
    const select = screen.getByLabelText("Appraisal Period", { exact: false }) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("AparNewForm — GAP-HR-APAR-NEW-02/NEW-05 EntityPicker-based officer selection", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "new-apar-id" }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    searchEmployeesMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never shows 'UUID' anywhere in the form copy (NEW-02)", () => {
    renderForm();
    expect(screen.queryByText(/UUID/i)).not.toBeInTheDocument();
  });

  it("selecting an employee calls the shared searchEmployees adapter, not a bulk limit=200 fetch (NEW-05)", async () => {
    renderForm();
    await pickEmployee("Employee", "Alice Appraisee (E100)");
    expect(searchEmployeesMock).toHaveBeenCalledWith("Alic", expect.any(AbortSignal));
    // The create submit is the only thing that should hit the global fetch
    // mock here -- the employee directory itself goes through the adapter.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the four picked employee ids and the selected period to POST /v1/hrms/apar", async () => {
    renderForm();
    await fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      appraisalPeriod: expect.stringMatching(/^\d{4}-\d{2}$/),
      reportingOfficerId: "550e8400-e29b-41d4-a716-446655440001",
      reviewingOfficerId: "550e8400-e29b-41d4-a716-446655440002",
      acceptingAuthorityId: "550e8400-e29b-41d4-a716-446655440003",
    });
  });
});

describe("AparNewForm — GAP-HR-APAR-NEW-03 client-side duplicate-officer validation", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    searchEmployeesMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("excludes an already-selected person from another picker's own search results", async () => {
    renderForm();
    await pickEmployee("Employee", "Alice Appraisee (E100)");
    searchEmployeesMock.mockClear();

    fireEvent.change(screen.getByLabelText("Reporting Officer", { exact: false }), { target: { value: "Alice" } });
    // The adapter itself would return Alice for this query (sanity-checked
    // by pickEmployee's own successful use of her above); the form's
    // `excluding()` wrapper must filter her back out since she is already
    // the Employee, leaving zero results. Each of the 4 EntityPickers
    // renders its own role="status" region, so this checks all of them
    // (not a single, ambiguous query) for the one that actually reports
    // "no matches" -- not a vacuous "not found yet" read before the
    // debounced search settles.
    await waitFor(() => {
      const statuses = screen.getAllByRole("status");
      expect(statuses.some((s) => /no matching employees/i.test(s.textContent ?? ""))).toBe(true);
    });
    expect(screen.queryByText("Alice Appraisee (E100)")).not.toBeInTheDocument();
  });
});

// GAP-HR-APAR-NEW-03's own acceptance criterion calls for a schema-level
// unit test ("Unit test schema: same person as RO and RvO fails with a
// message on reviewingOfficerId; appraisee as AA fails") precisely because
// the EntityPicker-level exclusion above makes this combination
// unreachable through ordinary sequential UI interaction once any one
// field is chosen -- the schema is still the authoritative backstop (e.g.
// a picker whose options were fetched before another field changed), and
// is exercised directly here rather than via a brittle DOM-level race.
describe("aparNewSchema — GAP-HR-APAR-NEW-03", () => {
  const VALID = {
    employeeId: "550e8400-e29b-41d4-a716-446655440000",
    appraisalPeriod: "2025-26",
    reportingOfficerId: "550e8400-e29b-41d4-a716-446655440001",
    reviewingOfficerId: "550e8400-e29b-41d4-a716-446655440002",
    acceptingAuthorityId: "550e8400-e29b-41d4-a716-446655440003",
  };

  it("accepts a fully valid, all-distinct set", () => {
    expect(aparNewSchema.safeParse(VALID).success).toBe(true);
  });

  it("same person as RO and RvO fails with a message on reviewingOfficerId", () => {
    const result = aparNewSchema.safeParse({ ...VALID, reviewingOfficerId: VALID.reportingOfficerId });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "reviewingOfficerId");
      expect(issue).toBeDefined();
      expect(issue?.message).toBe("NOT_DISTINCT");
    }
  });

  it("appraisee as Accepting Authority fails on acceptingAuthorityId", () => {
    const result = aparNewSchema.safeParse({ ...VALID, acceptingAuthorityId: VALID.employeeId });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "acceptingAuthorityId");
      expect(issue).toBeDefined();
      expect(issue?.message).toBe("SELF_OFFICER");
    }
  });

  it("a still-unselected (null) field fails as REQUIRED, not a raw Zod type message", () => {
    const result = aparNewSchema.safeParse({ ...VALID, employeeId: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.find((i) => i.path[0] === "employeeId")?.message).toBe("REQUIRED");
    }
  });
});

describe("AparNewForm — GAP-HR-APAR-NEW-06 Cancel is a real link", () => {
  it("renders Cancel as a link to /hr/apar, not a button doing router.push", () => {
    renderForm();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    expect(cancel).toHaveAttribute("href", "/hr/apar");
  });
});

// GAP-HR-SF09A-010 / GAP-HR-APAR-NEW-01: page.tsx's own server-side gate.
// Same mocking convention as hr/disciplinary/page.test.tsx: control the
// session role directly at the roleGuard module boundary.
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import AparNewPage from "./page";

describe("AparNewPage — GAP-HR-APAR-NEW-01 role gate", () => {
  beforeEach(() => {
    mockRoles = ["hr_admin"];
  });

  it("shows PermissionDenied for manager, without ever rendering the form (used to 403 only on submit)", () => {
    mockRoles = ["manager"];
    render(<AparNewPage />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Employee")).not.toBeInTheDocument();
  });

  it("shows PermissionDenied for a plain employee", () => {
    mockRoles = ["employee"];
    render(<AparNewPage />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("renders the form for hr_officer", () => {
    mockRoles = ["hr_officer"];
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AparNewPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText("Employee", { exact: false })).toBeInTheDocument();
  });

  it("renders the form for hr_admin", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AparNewPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText("Employee", { exact: false })).toBeInTheDocument();
  });
});
