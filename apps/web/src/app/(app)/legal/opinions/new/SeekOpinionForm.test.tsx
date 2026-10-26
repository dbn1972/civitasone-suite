import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock("@/lib/useFormError", () => ({
  useFormError: () => ({ fromResponse: async () => ({ message: "failed" }) }),
}));

import { SeekOpinionForm } from "./SeekOpinionForm";

const DEPTS = [
  { id: "99999999-aaaa-4000-8000-000000000001", name: "Revenue Department" },
  { id: "99999999-aaaa-4000-8000-000000000002", name: "Public Works Department" },
];

/** Departments GET resolves with the org list; every other call (the POST) resolves with `post`. */
function stubFetch(post: unknown = { id: "x" }, deptStatus = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/v1/legal/departments")) {
      return deptStatus === 200
        ? ({ ok: true, status: 200, json: async () => ({ items: DEPTS }) } as unknown as Response)
        : ({ ok: false, status: deptStatus, json: async () => ({}) } as unknown as Response);
    }
    return { ok: true, json: async () => post } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const postCall = (m: ReturnType<typeof vi.fn>) => m.mock.calls.find((c) => String(c[0]).endsWith("/v1/legal/opinions"))!;

async function readyDepartments() {
  await waitFor(() => expect(screen.getByRole("option", { name: "Revenue Department" })).toBeInTheDocument());
}

async function fillAndSubmit(subject = "Tender dispute", question = "Can we cancel the tender?", dept: string | null = DEPTS[0]!.id) {
  if (dept) {
    await readyDepartments();
    fireEvent.change(screen.getByLabelText(/^Department/), { target: { value: dept } });
  }
  fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText(/Question/i), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /Submit request/i }));
}

describe("SeekOpinionForm (GAP-LEGAL-OPINIONS-NEW-01 / NEW-02)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("posts to the real opinions endpoint and redirects to the created detail page", async () => {
    const fetchMock = stubFetch({ id: "new-op-7" });
    render(<SeekOpinionForm />);
    await fillAndSubmit();
    // confirm dialog
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));

    await waitFor(() => expect(postCall(fetchMock)).toBeDefined());
    const [url, init] = postCall(fetchMock);
    expect(url).toBe("/api/proxy/v1/legal/opinions"); // NOT /notices
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.subject).toBe("Tender dispute");
    expect(body.question).toBe("Can we cancel the tender?");
    // NEW-02: no client-generated reference sent when the field is blank
    expect(body).not.toHaveProperty("opinionNo");
    expect(body).not.toHaveProperty("soughtBy");
    expect(body).not.toHaveProperty("noticeNo");

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/legal/opinions/new-op-7"));
  });

  it("sends a user-typed reference as opinionNo, never a Math.random value", async () => {
    const fetchMock = stubFetch();
    render(<SeekOpinionForm />);
    fireEvent.change(screen.getByLabelText(/Reference no/i), { target: { value: "OPN/2026/0009" } });
    await fillAndSubmit();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));
    await waitFor(() => expect(postCall(fetchMock)).toBeDefined());
    const body = JSON.parse((postCall(fetchMock)[1] as RequestInit).body as string);
    expect(body.opinionNo).toBe("OPN/2026/0009");
  });

  it("sends soughtBy when typed and omits it when blank", async () => {
    const fetchMock = stubFetch();
    render(<SeekOpinionForm />);
    fireEvent.change(screen.getByLabelText(/Sought by/i), { target: { value: "  Legal Cell, Dept of X " } });
    await fillAndSubmit();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));
    await waitFor(() => expect(postCall(fetchMock)).toBeDefined());
    const body = JSON.parse((postCall(fetchMock)[1] as RequestInit).body as string);
    expect(body.soughtBy).toBe("Legal Cell, Dept of X");
  });

  it("blocks submit without a subject and question", async () => {
    stubFetch();
    render(<SeekOpinionForm />);
    await readyDepartments();
    fireEvent.click(screen.getByRole("button", { name: /Submit request/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
  });
});

describe("SeekOpinionForm addressee (GAP-LEGAL-OPINIONS-NEW-03, decision #13)", () => {
  beforeEach(() => { pushMock.mockReset(); vi.restoreAllMocks(); });
  afterEach(() => vi.restoreAllMocks());

  it("defaults to an internal department picker and sends the department id", async () => {
    const fetchMock = stubFetch();
    render(<SeekOpinionForm />);
    expect(screen.getByRole("radio", { name: "Internal department" })).toBeChecked();
    await fillAndSubmit("Subject one", "Question one?", DEPTS[1]!.id);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));
    await waitFor(() => expect(postCall(fetchMock)).toBeDefined());
    const body = JSON.parse((postCall(fetchMock)[1] as RequestInit).body as string);
    expect(body.addressee).toEqual({ type: "department", departmentId: DEPTS[1]!.id });
  });

  it("the external-party option takes free text and sends it as the addressee", async () => {
    const fetchMock = stubFetch();
    render(<SeekOpinionForm />);
    await readyDepartments();
    fireEvent.click(screen.getByRole("radio", { name: "External party" }));
    fireEvent.change(screen.getByLabelText("External party name *"), { target: { value: "M/s Acme Infra Ltd" } });
    await fillAndSubmit("Subject two", "Question two?", null);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Submit request/ }));
    await waitFor(() => expect(postCall(fetchMock)).toBeDefined());
    const body = JSON.parse((postCall(fetchMock)[1] as RequestInit).body as string);
    expect(body.addressee).toEqual({ type: "external", name: "M/s Acme Infra Ltd" });
  });

  it("will not submit with no addressee chosen", async () => {
    const fetchMock = stubFetch();
    render(<SeekOpinionForm />);
    await readyDepartments();
    await fillAndSubmit("Subject three", "Question three?", null);
    expect(await screen.findByText("Select the department this opinion is addressed to.")).toBeInTheDocument();
    expect(postCall(fetchMock)).toBeUndefined();
  });

  it("says so when the department list cannot be loaded", async () => {
    stubFetch({}, 503);
    render(<SeekOpinionForm />);
    expect(await screen.findByText(/department list could not be loaded/)).toBeInTheDocument();
  });
});
