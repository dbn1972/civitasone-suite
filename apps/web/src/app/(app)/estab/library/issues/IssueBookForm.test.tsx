import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { IssueBookForm } from "./IssueBookForm";
import type { LibraryBookSummary } from "@civitasone/types";

// ── test data ────────────────────────────────────────────────────────────
const VALID_UUID = "00000000-0000-0000-0000-000000000001"; // gitleaks:allow

const EMPLOYEES = [
  { id: VALID_UUID, employeeNo: "E-001", name: "Priya Sharma", department: "Admin" },
];

const books: LibraryBookSummary[] = [
  {
    id: "b1",
    accessionNo: "ACC-001",
    title: "Fundamental Rules",
    author: "GoI",
    isbn: null,
    category: null,
    copiesTotal: 3,
    copiesAvailable: 2,
    status: "available",
  },
] as unknown as LibraryBookSummary[];

// ── helpers ──────────────────────────────────────────────────────────────
function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>,
  );
}

function futureDateStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Mock fetch to handle HRMS employee search and estab issue POST */
function mockFetch(overrides?: { issueRes?: Response }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/hrms/employees")) {
      return new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 });
    }
    if (url.includes("/estab/library/issues")) {
      return overrides?.issueRes ?? new Response(
        JSON.stringify({ id: "issue-xyz", status: "accepted", correlationId: "c1" }), // gitleaks:allow
        { status: 202 },
      );
    }
    return new Response(null, { status: 404 });
  });
}

// ── pick an employee (type → click option) ──────────────────────────────
async function pickEmployee(name: string) {
  const empInput = screen.getByLabelText("Borrowing employee");
  fireEvent.change(empInput, { target: { value: name } });
  const option = await screen.findByText("Priya Sharma (E-001)");
  fireEvent.mouseDown(option);
}

describe("IssueBookForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-01: confirm dialog shows employee name, not UUID", async () => {
    mockFetch();
    render(<IssueBookForm books={books} />);

    fireEvent.change(screen.getByRole("combobox", { name: /Book/ }), { target: { value: "b1" } });
    await pickEmployee("Priya");
    fireEvent.change(screen.getByLabelText(/Due Date/), { target: { value: futureDateStr(14) } });
    fireEvent.click(screen.getByRole("button", { name: "Issue Book" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Issue book" })).toBeInTheDocument());
    // Dialog must show the picked name, not a UUID
    expect(screen.getByText(/Priya Sharma/)).toBeInTheDocument();
    expect(screen.queryByText(VALID_UUID)).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-06: success message names the book and never shows the record id", async () => {
    mockFetch();
    render(<IssueBookForm books={books} />);

    fireEvent.change(screen.getByRole("combobox", { name: /Book/ }), { target: { value: "b1" } });
    await pickEmployee("Priya");
    fireEvent.change(screen.getByLabelText(/Due Date/), { target: { value: futureDateStr(14) } });
    fireEvent.click(screen.getByRole("button", { name: "Issue Book" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Issue book" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Issue book" }));

    await waitFor(() => {
      expect(screen.getByText(/Issued .*Fundamental Rules/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/issue-xyz/)).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-03: rejects a due date in the past and does not POST", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/hrms/employees")) {
        return new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    render(<IssueBookForm books={books} />);
    fireEvent.change(screen.getByRole("combobox", { name: /Book/ }), { target: { value: "b1" } });
    await pickEmployee("Priya");
    const dueInput = screen.getByLabelText(/Due Date/) as HTMLInputElement;
    fireEvent.change(dueInput, { target: { value: "2020-01-01" } });
    await waitFor(() => expect(dueInput.value).toBe("2020-01-01"));
    fireEvent.click(screen.getByRole("button", { name: "Issue Book" }));

    await waitFor(() =>
      expect(screen.getByText("Due date cannot be in the past.")).toBeInTheDocument(),
    );
    // Only HRMS calls, no issue POST
    const issueCalls = fetchSpy.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return url.includes("/estab/library/issues");
    });
    expect(issueCalls).toHaveLength(0);
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-01: validation requires employee selection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    render(<IssueBookForm books={books} />);
    fireEvent.change(screen.getByRole("combobox", { name: /Book/ }), { target: { value: "b1" } });
    // Do NOT pick an employee
    fireEvent.change(screen.getByLabelText(/Due Date/), { target: { value: futureDateStr(14) } });
    fireEvent.click(screen.getByRole("button", { name: "Issue Book" }));

    await waitFor(() =>
      expect(screen.getByText("Select the borrowing employee.")).toBeInTheDocument(),
    );
  });
});
