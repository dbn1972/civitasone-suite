import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RequisitionsClient } from "./RequisitionsClient";

const DEPT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OPENING = "9a0c0305-4f89-41d3-9a0c-0305e82c3333";
const REQS = [
  { id: "r-draft", requisitionNo: "REQ-0001", title: "Junior Engineer", vacancies: 3, status: "draft", currentStage: -1 },
  { id: "r-pending", requisitionNo: "REQ-0002", title: "Accountant", vacancies: 1, status: "pending_approval", currentStage: 1, approvalChain: [{ stage: "Hiring Manager", role: "hiring_manager" }, { stage: "HR", role: "hr_admin" }] },
  { id: "r-approved", requisitionNo: "REQ-0003", title: "Clerk", vacancies: 2, status: "approved", currentStage: 3 },
];

type Sent = { url: string; method: string; body: Record<string, unknown> };
function mockApi(opts: { list?: () => Response; write?: (url: string) => Response } = {}) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      if (url.includes("/departments")) return new Response(JSON.stringify({ data: [{ id: DEPT, name: "Finance" }] }));
      if (url.includes("/designations")) return new Response(JSON.stringify({ data: [] }));
      if (url.endsWith("/requisitions")) return opts.list ? opts.list() : new Response(JSON.stringify({ data: REQS }));
    }
    sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
    return opts.write ? opts.write(url) : new Response(JSON.stringify({ publishedOpeningId: OPENING }), { status: 200 });
  }));
  return sent;
}
const renderIt = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><RequisitionsClient /></NextIntlClientProvider>);

describe("RequisitionsClient (GAP-RECRUITMENT-NEW-06)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers only the applicable action per status and names the stage a requisition is waiting on", async () => {
    mockApi();
    renderIt();
    const draft = (await screen.findByText("REQ-0001")).closest("tr")!;
    expect(within(draft).getByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
    const pending = screen.getByText("REQ-0002").closest("tr")!;
    expect(within(pending).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Return for correction" })).toBeInTheDocument();
    expect(within(pending).getByText(/Waiting on: HR/)).toBeInTheDocument();
    const approved = screen.getByText("REQ-0003").closest("tr")!;
    expect(within(approved).getByRole("button", { name: "Publish as vacancy" })).toBeInTheDocument();
    expect(within(approved).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("publishing an approved requisition POSTs /publish and links to the created vacancy", async () => {
    const sent = mockApi();
    renderIt();
    const approved = (await screen.findByText("REQ-0003")).closest("tr")!;
    fireEvent.click(within(approved).getByRole("button", { name: "Publish as vacancy" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish as vacancy" }));
    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/requisitions/r-approved/publish") && s.method === "POST")).toBe(true));
    const link = await screen.findByRole("link", { name: "View vacancy" });
    expect(link).toHaveAttribute("href", `/hr/recruitment/${OPENING}`);
  });

  it("return requires a comment and sends it", async () => {
    const sent = mockApi();
    renderIt();
    const pending = (await screen.findByText("REQ-0002")).closest("tr")!;
    fireEvent.click(within(pending).getByRole("button", { name: "Return for correction" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Return for correction" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Comments/), { target: { value: "Justify the post count" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(sent.find((s) => s.url.endsWith("/requisitions/r-pending/return"))?.body).toEqual({ comments: "Justify the post count" }));
  });

  it("shows the server's refusal inside the dialog instead of closing it (e.g. maker-checker)", async () => {
    mockApi({ write: () => new Response(JSON.stringify({ code: "SOD_VIOLATION", message: "x" }), { status: 409 }) });
    renderIt();
    const pending = (await screen.findByText("REQ-0002")).closest("tr")!;
    fireEvent.click(within(pending).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText(/./, { selector: "[aria-live]" })).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("creates a draft requisition from the form (title, department, vacancies)", async () => {
    const sent = mockApi();
    renderIt();
    await screen.findByText("REQ-0001");
    await waitFor(() => expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Position title"), { target: { value: "Stenographer" } });
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: DEPT } });
    fireEvent.change(screen.getByLabelText("Number of vacancies"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Create requisition" }));
    await waitFor(() => expect(sent.find((s) => s.url.endsWith("/requisitions") && s.method === "POST")?.body).toEqual({ title: "Stenographer", departmentId: DEPT, vacancies: 4 }));
  });

  it("does not post an incomplete form", async () => {
    const sent = mockApi();
    renderIt();
    await screen.findByText("REQ-0001");
    fireEvent.click(screen.getByRole("button", { name: "Create requisition" }));
    expect(await screen.findByText(/Enter a title/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("a failed list load is an error with Retry, not an empty list", async () => {
    mockApi({ list: () => new Response("{}", { status: 500 }) });
    renderIt();
    expect(await screen.findByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No requisitions yet.")).not.toBeInTheDocument();
  });
});
