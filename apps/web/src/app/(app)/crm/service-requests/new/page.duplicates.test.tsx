import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

/**
 * GAP-CRM-SERVICE-REQUESTS-NEW-04 - the intake form warns about an OPEN request already on file
 * for the phone / email being entered ("Possible duplicate: SRQ-... "), links to it, and asks for
 * a confirmation only when the SAME service type is already open for the same citizen. It warns;
 * it never blocks, and a failed lookup never stops a request being filed.
 */
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import NewServiceRequestPage from "./page";

const DUP_URL = "/api/proxy/v1/crm/service-requests/duplicate-check";
const SR_URL = "/api/proxy/v1/crm/service-requests";

type Dup = { id: string; referenceNo: string; serviceType: string; status: string };
const OPEN_BIRTH: Dup = { id: "sr-9", referenceNo: "SRQ/2026/ABC999", serviceType: "Birth Certificate", status: "in_progress" };
const OPEN_INCOME: Dup = { id: "sr-8", referenceNo: "SRQ/2026/INC888", serviceType: "Income Certificate", status: "open" };

/** Route the duplicate lookup and the filing separately. */
function mockApi(opts: { duplicates?: Dup[]; dupStatus?: number; dupDelayMs?: number } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === DUP_URL) {
      if (opts.dupDelayMs) await new Promise((r) => setTimeout(r, opts.dupDelayMs));
      const status = opts.dupStatus ?? 200;
      return new Response(JSON.stringify({ data: opts.duplicates ?? [] }), { status });
    }
    if (url === SR_URL && (init as RequestInit | undefined)?.method === "POST") {
      return new Response(JSON.stringify({ data: { id: "new-sr" } }), { status: 201 });
    }
    return new Response("{}", { status: 500 }); // service-type master etc. -> labelled fallback list
  });
}

const dupCalls = (spy: ReturnType<typeof mockApi>) => spy.mock.calls.filter(([u]) => String(u) === DUP_URL);
const filingCalls = (spy: ReturnType<typeof mockApi>) =>
  spy.mock.calls.filter(([u, i]) => String(u) === SR_URL && (i as RequestInit | undefined)?.method === "POST");

function fill() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
  fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
  fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  pushMock.mockReset();
});

describe("SR new form - possible duplicate (NEW-04)", () => {
  it("looks the phone up on blur - normalised, in the request BODY not the URL - and warns with a link", async () => {
    const spy = mockApi({ duplicates: [OPEN_BIRTH] });
    render(<NewServiceRequestPage />);
    const phone = screen.getByLabelText(/^Phone/);
    fireEvent.change(phone, { target: { value: "+91 98765-43210" } });
    fireEvent.blur(phone);

    const warning = await screen.findByText("Possible duplicate");
    const box = warning.closest("div")!;
    expect(within(box).getByText(/already has an open request/i)).toBeInTheDocument();
    expect(within(box).getByText(/Possible duplicate:/)).toBeInTheDocument();
    const link = within(box).getByRole("link", { name: "SRQ/2026/ABC999" });
    expect(link).toHaveAttribute("href", "/crm/service-requests/sr-9");
    expect(box).toHaveTextContent("Birth Certificate (In Progress)");

    expect(dupCalls(spy)).toHaveLength(1);
    const [url, init] = dupCalls(spy)[0]!;
    expect(String(url)).not.toContain("9876543210"); // a phone number never travels in a URL
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ phone: "9876543210" });
  });

  it("looks an email up too", async () => {
    const spy = mockApi({ duplicates: [OPEN_INCOME] });
    render(<NewServiceRequestPage />);
    const email = screen.getByLabelText(/^Email/);
    fireEvent.change(email, { target: { value: "asha@example.com" } });
    fireEvent.blur(email);
    expect(await screen.findByText("Possible duplicate")).toBeInTheDocument();
    expect(JSON.parse((dupCalls(spy)[0]![1] as RequestInit).body as string)).toEqual({ email: "asha@example.com" });
  });

  it("sends both when both are entered", async () => {
    const spy = mockApi({ duplicates: [] });
    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "a@b.co" } });
    fireEvent.blur(screen.getByLabelText(/^Email/));
    await waitFor(() => expect(dupCalls(spy)).toHaveLength(1));
    expect(JSON.parse((dupCalls(spy)[0]![1] as RequestInit).body as string)).toEqual({ phone: "9876543210", email: "a@b.co" });
  });

  it("does not look up a malformed phone or email", async () => {
    const spy = mockApi({ duplicates: [OPEN_BIRTH] });
    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "12345" } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "not-an-email" } });
    fireEvent.blur(screen.getByLabelText(/^Email/));
    await new Promise((r) => setTimeout(r, 30));
    expect(dupCalls(spy)).toHaveLength(0);
    expect(screen.queryByText("Possible duplicate")).not.toBeInTheDocument();
  });

  it("looks up once per distinct value, not on every blur", async () => {
    const spy = mockApi({ duplicates: [] });
    render(<NewServiceRequestPage />);
    const phone = screen.getByLabelText(/^Phone/);
    fireEvent.change(phone, { target: { value: "9876543210" } });
    fireEvent.blur(phone);
    fireEvent.blur(phone);
    await waitFor(() => expect(dupCalls(spy)).toHaveLength(1));
    fireEvent.blur(phone);
    expect(dupCalls(spy)).toHaveLength(1);
    fireEvent.change(phone, { target: { value: "9876543211" } });
    fireEvent.blur(phone);
    await waitFor(() => expect(dupCalls(spy)).toHaveLength(2));
  });

  it("clears the warning when the number is changed to one with no open request", async () => {
    const spy = mockApi({ duplicates: [OPEN_BIRTH] });
    render(<NewServiceRequestPage />);
    const phone = screen.getByLabelText(/^Phone/);
    fireEvent.change(phone, { target: { value: "9876543210" } });
    fireEvent.blur(phone);
    await screen.findByText("Possible duplicate");
    spy.mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    fireEvent.change(phone, { target: { value: "9876543299" } });
    fireEvent.blur(phone);
    await waitFor(() => expect(screen.queryByText("Possible duplicate")).not.toBeInTheDocument());
  });

  it("shows nothing when there is no open request", async () => {
    const spy = mockApi({ duplicates: [] });
    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    await waitFor(() => expect(dupCalls(spy)).toHaveLength(1));
    expect(screen.queryByText("Possible duplicate")).not.toBeInTheDocument();
  });

  it("says the check could not run - and still lets the request be filed - when the lookup fails", async () => {
    const spy = mockApi({ dupStatus: 503 });
    render(<NewServiceRequestPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    expect(await screen.findByText(/Couldn.t check for existing requests/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/new-sr"));
    expect(filingCalls(spy)).toHaveLength(1);
  });
});

describe("SR new form - confirm before filing the same request twice (NEW-04)", () => {
  it("asks first when the SAME service type is already open for this citizen; Cancel files nothing", async () => {
    const spy = mockApi({ duplicates: [OPEN_BIRTH] });
    render(<NewServiceRequestPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    await screen.findByText("Possible duplicate");
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("File another request of the same type?")).toBeInTheDocument();
    expect(within(dialog).getByText(/SRQ\/2026\/ABC999 is already open for this citizen and service type/)).toBeInTheDocument();
    expect(filingCalls(spy)).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(filingCalls(spy)).toHaveLength(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("files the request once the clerk confirms it is a different matter", async () => {
    const spy = mockApi({ duplicates: [OPEN_BIRTH] });
    render(<NewServiceRequestPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    await screen.findByText("Possible duplicate");
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "File anyway" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/new-sr"));
    expect(filingCalls(spy)).toHaveLength(1);
    const body = JSON.parse((filingCalls(spy)[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ citizenName: "Meera Devi", serviceType: "Birth Certificate", citizenPhone: "9876543210" });
  });

  it("does NOT ask when the open request is a DIFFERENT service type (warn only)", async () => {
    const spy = mockApi({ duplicates: [OPEN_INCOME] });
    render(<NewServiceRequestPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    await screen.findByText("Possible duplicate");
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/new-sr"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(filingCalls(spy)).toHaveLength(1);
  });

  it("waits for a lookup still in flight when Submit is pressed straight after typing the number", async () => {
    const spy = mockApi({ duplicates: [OPEN_BIRTH], dupDelayMs: 60 });
    render(<NewServiceRequestPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.blur(screen.getByLabelText(/^Phone/));
    // No pause: the click lands while the lookup is still pending, as a real click-away would.
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(filingCalls(spy)).toHaveLength(0);
  });

  it("an open request for a different citizen's number never reaches the confirm (no lookup, plain filing)", async () => {
    const spy = mockApi({ duplicates: [] });
    render(<NewServiceRequestPage />);
    fill();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(filingCalls(spy)).toHaveLength(1);
  });
});
