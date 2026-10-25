import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();

const suspendSearchParams = { on: false };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => {
    if (suspendSearchParams.on) throw new Promise(() => {}); // never resolves -> Suspense fallback stays
    return searchParamsMock;
  },
}));

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewMbPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";
const AWARD = "22222222-2222-2222-2222-222222222222";

/** Default: awards GET returns empty (keeps the text input), POST succeeds. */
function mockFetch(opts: { awards?: unknown[]; postStatus?: number; postBody?: unknown } = {}) {
  const { awards = [], postStatus = 202, postBody = {} } = opts;
  return vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.endsWith("/awards")) {
      return Promise.resolve(new Response(JSON.stringify({ data: awards }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(postBody), { status: postStatus, headers: { "content-type": "application/json" } }));
  }) as typeof fetch);
}

function postCall(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
}

describe("Issue Measurement Book form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    toastSuccess.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("prefills the Work ID from the ?workId passed by the billing detail page", async () => {
    mockFetch();
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    expect(await screen.findByPlaceholderText("UUID of the work")).toHaveValue(WORK);
  });

  it("offers a work PICKER (not a UUID box) when no param is supplied (tenant-wide entry point)", async () => {
    mockFetch();
    render(<NewMbPage />);
    expect(await screen.findByPlaceholderText("Search by work number or description…")).toHaveValue("");
    expect(screen.queryByPlaceholderText("UUID of the work")).not.toBeInTheDocument();
  });

  it("blocks submit without a chosen work and never POSTs (UUID guard)", async () => {
    const spy = mockFetch();
    render(<NewMbPage />);
    await screen.findByPlaceholderText("Search by work number or description…");
    fireEvent.change(screen.getByPlaceholderText("e.g. MB/2024-25/001"), { target: { value: "MB/1" } });
    fireEvent.change(screen.getByPlaceholderText("UUID of the award"), { target: { value: AWARD } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Select the work/i);
    expect(postCall(spy)).toBeUndefined();
  });

  it("a non-UUID ?workId= is ignored: back link and redirect never carry it (NEW-MB-04)", async () => {
    mockFetch();
    searchParamsMock = new URLSearchParams("workId=../../admin");
    render(<NewMbPage />);
    expect(await screen.findByPlaceholderText("Search by work number or description…")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("../../admin");
  });

  it("maps a 409 DUPLICATE_MB_NUMBER to a field message and keeps the form data (NEW-MB-03)", async () => {
    // The body is the FLAT envelope works-service really returns (packages/schemas createFastifyErrorHandler):
    // { code, message, correlationId, retryable } -- the machine code is at the top level, not under `error`.
    mockFetch({
      postStatus: 409,
      postBody: { code: "DUPLICATE_MB_NUMBER", message: "MB number already used for this work", correlationId: "c-1", retryable: false },
    });
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    await screen.findByPlaceholderText("UUID of the work");
    fireEvent.change(screen.getByPlaceholderText("UUID of the award"), { target: { value: AWARD } });
    fireEvent.change(screen.getByPlaceholderText("e.g. MB/2024-25/001"), { target: { value: "MB/9" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    const fieldError = await screen.findByText(/already used for this work/i);
    // The message sits on the MB number field (linked via aria-describedby), not in a page-level banner.
    expect(fieldError).toHaveAttribute("id", "new-mb-number-error");
    expect(screen.getByPlaceholderText("e.g. MB/2024-25/001")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByPlaceholderText("e.g. MB/2024-25/001")).toHaveAttribute("aria-describedby", "new-mb-number-error");
    expect(screen.getByPlaceholderText("e.g. MB/2024-25/001")).toHaveValue("MB/9");
    expect(screen.getByPlaceholderText("UUID of the award")).toHaveValue(AWARD);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("a 409 with a different code stays a page-level banner and does NOT mark the MB number field invalid", async () => {
    mockFetch({ postStatus: 409, postBody: { code: "SOMETHING_ELSE", message: "x", correlationId: "c-2", retryable: false } });
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    await screen.findByPlaceholderText("UUID of the work");
    fireEvent.change(screen.getByPlaceholderText("UUID of the award"), { target: { value: AWARD } });
    fireEvent.change(screen.getByPlaceholderText("e.g. MB/2024-25/001"), { target: { value: "MB/10" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByRole("alert");
    expect(screen.getByPlaceholderText("e.g. MB/2024-25/001")).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById("new-mb-number-error")).toBeNull();
  });

  it("offers an award SELECT (not a UUID input) when the work's awards load (NEW-MB-01)", async () => {
    mockFetch({ awards: [{ id: AWARD, agreementNumber: "AGR/7", contractorName: "Acme", status: "do_finalized" }] });
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    // The award field upgrades from text input to a <select> once the list loads.
    await waitFor(() => {
      const awardField = screen.getByLabelText(/^Award/i) as HTMLElement;
      expect(awardField.tagName).toBe("SELECT");
    });
    const awardField = screen.getByLabelText(/^Award/i) as HTMLSelectElement;
    expect(within_options(awardField)).toContain("AGR/7 — Acme");
    expect(screen.queryByPlaceholderText("UUID of the award")).not.toBeInTheDocument();
  });

  it("uses one success string for both banner and toast, and trims values before POST (NEW-MB-02/03)", async () => {
    const spy = mockFetch();
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    await screen.findByPlaceholderText("UUID of the work");
    fireEvent.change(screen.getByPlaceholderText("UUID of the award"), { target: { value: `  ${AWARD}  ` } });
    fireEvent.change(screen.getByPlaceholderText("e.g. MB/2024-25/001"), { target: { value: "  MB/2024-25/001  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(postCall(spy)).toBeTruthy());
    const body = JSON.parse((postCall(spy)![1] as RequestInit).body as string);
    expect(body.awardId).toBe(AWARD); // trimmed
    expect(body.mbNumber).toBe("MB/2024-25/001"); // trimmed

    // Banner and toast carry the identical message.
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Measurement book issued.");
    expect(toastSuccess).toHaveBeenCalledWith("Measurement book issued.");
  });

  it("shows a clerk-safe message, never the raw backend text, when the create fails (UX-016)", async () => {
    mockFetch({ postStatus: 409, postBody: { message: "mb_number already exists for this award" } });
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
    render(<NewMbPage />);
    await screen.findByPlaceholderText("UUID of the work");
    fireEvent.change(screen.getByPlaceholderText("UUID of the award"), { target: { value: AWARD } });
    fireEvent.change(screen.getByPlaceholderText("e.g. MB/2024-25/001"), { target: { value: "MB/2024-25/001" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() =>
      expect(alert).toHaveTextContent(/This measurement book was changed by someone else\. Refresh to see the latest version, then try again\./),
    );
    expect(alert.textContent).not.toMatch(/mb_number already exists/i);
    expect(alert.textContent).not.toMatch(/\b409\b/);
  });
});

function within_options(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.textContent ?? "");
}

describe("Suspense fallback (BILLS-NEW-04 / MEASUREMENTS-NEW-04 / NEW-MB-04)", () => {
  it("renders a skeleton, not an empty page, while useSearchParams() suspends", () => {
    suspendSearchParams.on = true;
    try {
      const { container } = render(<NewMbPage />);
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.queryByRole("button", { name: /submit|generate bill|record measurement/i })).not.toBeInTheDocument();
    } finally {
      suspendSearchParams.on = false;
    }
  });
});

describe("Issue Measurement Book duplicate-submit latch (CLOS3-S3-15)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    toastSuccess.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK}`);
  });

  async function fillValid(): Promise<HTMLElement> {
    render(<NewMbPage />);
    await screen.findByPlaceholderText("UUID of the work");
    fireEvent.change(screen.getByPlaceholderText("UUID of the award"), { target: { value: AWARD } });
    fireEvent.change(screen.getByPlaceholderText("e.g. MB/2024-25/001"), { target: { value: "MB/2024-25/009" } });
    return screen.getByRole("button", { name: "Submit" });
  }
  const posts = (spy: ReturnType<typeof mockFetch>) =>
    spy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");

  it("a second submit while the redirect is pending does not create a duplicate MB", async () => {
    const spy = mockFetch({ postStatus: 201 });
    const btn = await fillValid();
    const form = btn.closest("form") as HTMLFormElement;
    fireEvent.click(btn);
    await screen.findByText("Measurement book issued.");
    expect(screen.getByRole("button", { name: /Submit|Submitting/ })).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts(spy)).toHaveLength(1);
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(posts(spy)).toHaveLength(1);
  });

  it("a failed save leaves the form retryable", async () => {
    const spy = mockFetch({ postStatus: 500 });
    const btn = await fillValid();
    fireEvent.click(btn);
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(posts(spy)).toHaveLength(2));
  });
});
