import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

import { GuidedFileWizard } from "./GuidedFileWizard";

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function mockFetch(impl: FetchImpl) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
    impl(String(input), init as RequestInit | undefined),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const OFFICER_UUID = "3f9a1c2e-1111-4000-8000-000000000abc";

beforeEach(() => {
  vi.restoreAllMocks();
  replaceMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GuidedFileWizard — UX-016 clerk-safe errors (regression)", () => {
  it("shows a clerk-safe message, never the raw response body or status, when a step's POST fails", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators")) return json({ data: [] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      if (u.includes("/hrms/employees")) return json({ data: [] });
      // Step 1 receipt POST (non-JSON body, 409)
      return new Response("dak_no already diarised this year", { status: 409 });
    });

    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/DAK number/i), { target: { value: "DAK/2026/001" } });
    fireEvent.change(screen.getByLabelText(/From \(sender\)/i), { target: { value: "Ministry of Roads" } });
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "Road repair request" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/dak_no already diarised/i);
    expect(document.body.textContent).not.toMatch(/\b409\b/);
  });
});

describe("GuidedFileWizard — GAP-ESTAB-WORKSPACE-06 (accessible stepper + operator fetch)", () => {
  it("renders a semantic stepper with exactly one aria-current step", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators")) return json({ data: [] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    const list = await screen.findByRole("list", { name: /progress/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    const current = items.filter((li) => li.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
  });

  it("shows a retry message when the operators fetch fails instead of a raw UUID input", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators")) return new Response("boom", { status: 500 });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "No DAK file" } });
    fireEvent.click(screen.getByLabelText(/starts from an inward receipt/i)); // uncheck DAK
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText(/Officer list could not be loaded/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/officer UUID/i)).not.toBeInTheDocument();
  });
});

describe("GuidedFileWizard — GAP-ESTAB-WORKSPACE-03 (classification role-gating + summary)", () => {
  it("does not offer classifications the officer is not cleared for", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators")) return json({ data: [] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "A file" } });
    fireEvent.click(screen.getByLabelText(/starts from an inward receipt/i));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const select = await screen.findByLabelText(/Classification/i);
    const optionValues = within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toContain("public");
    expect(optionValues).toContain("confidential");
    expect(optionValues).not.toContain("secret");
    expect(optionValues).not.toContain("top_secret");
  });
});

describe("GuidedFileWizard — GAP-ESTAB-WORKSPACE-04 (officer names, not raw ids)", () => {
  it("labels operators by resolved name, division and humanised role — never an id prefix", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators"))
        return json({ data: [{ id: "op1", employeeId: OFFICER_UUID, division: "Administration", deskRole: "section_officer", active: true }] });
      if (u.includes("/hrms/employees"))
        return json({ data: [{ id: OFFICER_UUID, name: "A. Kumar", designation: "SO" }] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "A file" } });
    fireEvent.click(screen.getByLabelText(/starts from an inward receipt/i));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const select = await screen.findByLabelText(/Mark to officer/i);
    const text = select.textContent ?? "";
    expect(text).toContain("A. Kumar · Administration · Section Officer");
    expect(text).not.toMatch(/[0-9a-f]{8}…/);
  });

  it("links to /estab/operators and shows no UUID input when there are no operators", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators")) return json({ data: [] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "A file" } });
    fireEvent.click(screen.getByLabelText(/starts from an inward receipt/i));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const link = await screen.findByRole("link", { name: /Enrol operators/i });
    expect(link).toHaveAttribute("href", "/estab/operators");
    expect(screen.queryByPlaceholderText(/officer UUID/i)).not.toBeInTheDocument();
  });
});

describe("GuidedFileWizard — GAP-ESTAB-WORKSPACE-05 (specific errors + no-id guard)", () => {
  it("surfaces the server's clerk-safe message prefixed by the failing step", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators"))
        return json({ data: [{ id: "op1", employeeId: OFFICER_UUID, division: "Admin", deskRole: "section_officer", active: true }] });
      if (u.includes("/hrms/employees")) return json({ data: [{ id: OFFICER_UUID, name: "A. Kumar" }] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      if (u.includes("/estab/files") && u.endsWith("/files"))
        return json({ message: "requires section_officer" }, 403);
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "A file" } });
    fireEvent.click(screen.getByLabelText(/starts from an inward receipt/i));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText(/Department/i), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText(/Mark to officer/i), { target: { value: OFFICER_UUID } });
    fireEvent.click(screen.getByRole("button", { name: /Open file & continue/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Open file: requires section_officer/i);
  });

  it("stays on step 2 when the open-file response carries no file id", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators"))
        return json({ data: [{ id: "op1", employeeId: OFFICER_UUID, division: "Admin", deskRole: "section_officer", active: true }] });
      if (u.includes("/hrms/employees")) return json({ data: [{ id: OFFICER_UUID, name: "A. Kumar" }] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      if (u.endsWith("/files")) return json({ status: "accepted" }); // NO id
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "A file" } });
    fireEvent.click(screen.getByLabelText(/starts from an inward receipt/i));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText(/Department/i), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText(/Mark to officer/i), { target: { value: OFFICER_UUID } });
    fireEvent.click(screen.getByRole("button", { name: /Open file & continue/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // still on step 2 — the Open file button is still present
    expect(screen.getByRole("button", { name: /Open file & continue/i })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not claim an opening note is on the file when none was entered", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators"))
        return json({ data: [{ id: "op1", employeeId: OFFICER_UUID, division: "Admin", deskRole: "section_officer", active: true }] });
      if (u.includes("/hrms/employees")) return json({ data: [{ id: OFFICER_UUID, name: "A. Kumar" }] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      if (u.endsWith("/files")) return json({ id: "file-123" });
      return json({ data: [] });
    });
    render(<GuidedFileWizard />);
    fireEvent.change(screen.getByLabelText(/^Subject/i), { target: { value: "A file" } });
    fireEvent.click(screen.getByLabelText(/starts from an inward receipt/i));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText(/Department/i), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText(/Mark to officer/i), { target: { value: OFFICER_UUID } });
    fireEvent.click(screen.getByRole("button", { name: /Open file & continue/i }));
    await screen.findByRole("button", { name: /Submit for approval/i });
    expect(screen.getByText(/Add your opening note on the file first/i)).toBeInTheDocument();
    expect(screen.queryByText(/Your opening note is on the file/i)).not.toBeInTheDocument();
  });
});

describe("GuidedFileWizard — GAP-ESTAB-WORKSPACE-01/02 (URL hydration + submit)", () => {
  it("hydrates a file from initialFileId and shows step 3 with a working file link", async () => {
    mockFetch(async (u) => {
      if (u.includes("/estab/operators")) return json({ data: [] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      if (u.includes("/estab/files/file-xyz")) return json({ fileNo: "ESTAB-A/00001/2026", classification: "confidential", noteSheets: [{ id: "n1", noteStatus: "draft" }] });
      return json({ data: [] });
    });
    render(<GuidedFileWizard initialFileId="file-xyz" initialStep={3} />);
    const submitBtn = await screen.findByRole("button", { name: /Submit for approval/i });
    expect(submitBtn).toBeEnabled();
    const link = screen.getByRole("link", { name: /Open the file/i });
    expect(link).toHaveAttribute("href", "/estab/files/file-xyz");
  });

  it("submits with the draft notingId once the note appears, and shows a file link on failure", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const submitBodies: unknown[] = [];
    mockFetch(async (u, init) => {
      if (u.includes("/estab/operators")) return json({ data: [] });
      if (u.includes("/estab/files/classifications")) return json({ allowed: ["public", "confidential"] });
      if (u.includes("/submit-for-approval")) { submitBodies.push(JSON.parse(String(init?.body))); return json({ id: "n9", status: "accepted" }); }
      if (u.includes("/estab/files/file-xyz")) {
        polls += 1;
        // draft note only appears on the 3rd poll
        return json({ fileNo: "ESTAB-A/1/2026", noteSheets: polls >= 3 ? [{ id: "n9", noteStatus: "draft" }] : [] });
      }
      return json({ data: [] });
    });
    render(<GuidedFileWizard initialFileId="file-xyz" initialStep={3} />);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /Submit for approval/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Submit for approval/i }));
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => expect(submitBodies).toHaveLength(1));
    expect(submitBodies[0]).toEqual({ notingId: "n9" });
  });
});
