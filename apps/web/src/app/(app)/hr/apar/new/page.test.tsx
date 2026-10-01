import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// GAP-HR-SF09A-010 / GAP-HR-APAR-NEW-01: the form body moved from page.tsx
// (now a server-component role gate, tested separately below) to
// AparNewForm.tsx. These pre-existing behavior tests just follow the move --
// no behavior under test changed.
import AparNewForm from "./AparNewForm";

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
  });
  afterEach(() => vi.unstubAllGlobals());

  // UX-017: AparNewForm now reads its copy through next-intl
  // (useTranslations("aparNew")), so it needs a real provider in the tree —
  // same pattern as citizen/grievances/GrievancesTable.test.tsx and
  // hr/employees/[id]/edit/EditEmployeeForm.test.tsx.
  function renderPage() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AparNewForm />
      </NextIntlClientProvider>,
    );
  }

  function fillAndSubmit() {
    fireEvent.change(screen.getByLabelText(/employee id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440000" },
    });
    fireEvent.change(screen.getByLabelText(/appraisal period/i), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText(/reporting officer id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440001" },
    });
    fireEvent.change(screen.getByLabelText(/reviewing officer id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440002" },
    });
    fireEvent.change(screen.getByLabelText(/accepting authority id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440003" },
    });
    fireEvent.click(screen.getByRole("button", { name: /initiate apar/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when initiation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderPage();
    fillAndSubmit();

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
    renderPage();
    fillAndSubmit();

    expect(await screen.findByText("Employee not found.")).toBeInTheDocument();
  });
});

// GAP-HR-SF09A-010 / GAP-HR-APAR-NEW-01: page.tsx's own new server-side gate.
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
    expect(screen.queryByLabelText(/employee id/i)).not.toBeInTheDocument();
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
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
  });

  it("renders the form for hr_admin", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AparNewPage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
  });
});
