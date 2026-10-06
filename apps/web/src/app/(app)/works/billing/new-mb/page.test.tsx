import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
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

  it("leaves Work ID empty when no param is supplied (tenant-wide entry point)", async () => {
    mockFetch();
    render(<NewMbPage />);
    expect(await screen.findByPlaceholderText("UUID of the work")).toHaveValue("");
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
