import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

let searchParamsMock = new URLSearchParams();
const pushMock = vi.fn();
const suspendSearchParams = { on: false };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => {
    if (suspendSearchParams.on) throw new Promise(() => {}); // never resolves -> Suspense fallback stays
    return searchParamsMock;
  },
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import RecordMeasurementPage from "./page";

const MB = "123e4567-e89b-12d3-a456-426614174000";
const BOQ = "223e4567-e89b-12d3-a456-426614174999";

function setMb(value: string) {
  // No workId param ⇒ MB field is a text input labelled "Measurement Book *".
  fireEvent.change(screen.getByLabelText(/Measurement Book/i), { target: { value } });
}

function postCall(spy: { mock: { calls: unknown[][] } }) {
  return (spy.mock.calls as [RequestInfo, RequestInit?][]).find((c) => (c[1]?.method ?? "GET") === "POST");
}

describe("RecordMeasurementPage — computed quantity (MEASUREMENTS-NEW-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams();
    pushMock.mockReset();
  });

  it("computes No. × L × B × D and offers it as a suggestion", () => {
    render(<RecordMeasurementPage />);
    fireEvent.change(screen.getByLabelText(/^Length/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Breadth/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^Depth/i), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText(/^No\./i), { target: { value: "2" } });
    expect(screen.getByText(/Computed from dimensions:/)).toHaveTextContent("6.000");
  });

  it("blocks a quantity that differs from the computed value until a remark is given", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 202 }));
    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/^BoQ Item/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Length/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Breadth/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "9" } }); // computed = 6
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/differs from the computed value/i);
    expect(postCall(spy)).toBeUndefined();

    // With a remark, the same submit now posts.
    fireEvent.change(screen.getByLabelText(/Remarks/i), { target: { value: "extra lift accounted separately" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    await waitFor(() => expect(postCall(spy)).toBeTruthy());
  });

  it("'Use computed' fills Quantity with the computed value", () => {
    render(<RecordMeasurementPage />);
    fireEvent.change(screen.getByLabelText(/^Length/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Breadth/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Use computed" }));
    expect(screen.getByLabelText(/^Quantity/i)).toHaveValue(8);
  });
});

describe("RecordMeasurementPage — validation (MEASUREMENTS-NEW-03/04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams();
    pushMock.mockReset();
  });

  it("rejects a non-positive quantity without posting", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/^BoQ Item/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/positive number/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the quantity as an exact JSON number (no float coercion surprises)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 202 }));
    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/^BoQ Item/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    await waitFor(() => expect(postCall(spy)).toBeTruthy());
    const body = JSON.parse((postCall(spy)![1] as RequestInit).body as string);
    expect(body.quantity).toBe(12.345);
  });
});

describe("RecordMeasurementPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    searchParamsMock = new URLSearchParams();
    pushMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when recording a measurement fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(<RecordMeasurementPage />);
    setMb(MB);
    fireEvent.change(screen.getByLabelText(/^BoQ Item/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});

describe("RecordMeasurementPage — BoQ picker + unit (MEASUREMENTS-NEW-02/03)", () => {
  const WORK_ID = "11111111-1111-1111-1111-111111111111";
  it("offers the work's BoQ items as a select, shows the unit, and sends 12.345 unchanged", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "GET" && url.endsWith(`/billing/${WORK_ID}/mbs`)) {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: MB, mbNumber: "MB/1" }] }), { status: 200 }));
      }
      if ((init?.method ?? "GET") === "GET" && url.endsWith(`/boq/${WORK_ID}`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: BOQ, itemCode: "2.1", itemDescription: "Earthwork", unit: "cum" }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 202 }));
    }) as typeof fetch);
    searchParamsMock = new URLSearchParams(`workId=${WORK_ID}`);
    render(<RecordMeasurementPage />);
    await waitFor(() => expect((screen.getByLabelText(/^BoQ Item/i) as HTMLElement).tagName).toBe("SELECT"));
    await waitFor(() => expect((screen.getByLabelText(/Measurement Book/i) as HTMLElement).tagName).toBe("SELECT"));
    fireEvent.change(screen.getByLabelText(/Measurement Book/i), { target: { value: MB } });
    fireEvent.change(screen.getByLabelText(/^BoQ Item/i), { target: { value: BOQ } });
    expect(await screen.findByLabelText(/^Quantity.*\(cum\)/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    await waitFor(() => expect(postCall(spy)).toBeTruthy());
    expect((postCall(spy)![1] as RequestInit).body as string).toContain('"quantity":12.345');
  });
});

describe("Suspense fallback (BILLS-NEW-04 / MEASUREMENTS-NEW-04 / NEW-MB-04)", () => {
  it("renders a skeleton, not an empty page, while useSearchParams() suspends", () => {
    suspendSearchParams.on = true;
    try {
      const { container } = render(<RecordMeasurementPage />);
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.queryByRole("button", { name: /submit|generate bill|record measurement/i })).not.toBeInTheDocument();
    } finally {
      suspendSearchParams.on = false;
    }
  });
});

describe("RecordMeasurementPage — negative dimension (MEASUREMENTS-NEW-04)", () => {
  it("shows an error and does not POST when a dimension is negative", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    searchParamsMock = new URLSearchParams();
    render(<RecordMeasurementPage />);
    fireEvent.change(screen.getByLabelText(/Measurement Book/i), { target: { value: MB } });
    fireEvent.change(screen.getByLabelText(/^BoQ Item/i), { target: { value: BOQ } });
    fireEvent.change(screen.getByLabelText(/^Quantity/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/^Length/i), { target: { value: "-1" } });
    // Programmatic submit: bypasses the native min=0 constraint, so the JS guard is what is proven.
    fireEvent.submit(screen.getByRole("button", { name: "Record Measurement" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Length must be a non-negative number/i));
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });
});

// GAP-WORKS-BILLING-MEASUREMENTS-NEW-05: works-service now refuses a measurement against an MB that is no longer a draft
// (409 MB_NOT_OPEN), so the form offers only draft books and explains the rest.
describe("RecordMeasurementPage — only draft measurement books accept measurements (MEASUREMENTS-NEW-05)", () => {
  const WORK_ID = "11111111-1111-1111-1111-111111111111";
  const MB_DRAFT = "323e4567-e89b-12d3-a456-426614174001";
  const MB_FINAL = "423e4567-e89b-12d3-a456-426614174002";
  const MB_SO = "523e4567-e89b-12d3-a456-426614174003";

  function stub(mbRows: unknown[], postResponse?: Response) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith(`/billing/${WORK_ID}/mbs`)) {
        return Promise.resolve(new Response(JSON.stringify({ data: mbRows }), { status: 200 }));
      }
      if (method === "GET" && url.endsWith(`/boq/${WORK_ID}`)) {
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: BOQ, itemCode: "2.1", itemDescription: "Earthwork", unit: "cum" }] }), { status: 200 }));
      }
      return Promise.resolve(postResponse ?? new Response(JSON.stringify({ data: {} }), { status: 202 }));
    }) as typeof fetch);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams(`workId=${WORK_ID}`);
  });

  it("lists only draft books and says how many are not listed, and why", async () => {
    stub([
      { id: MB_DRAFT, mbNumber: "MB/DRAFT", status: "draft" },
      { id: MB_SO, mbNumber: "MB/SO", status: "so_finalized" },
      { id: MB_FINAL, mbNumber: "MB/FINAL", status: "do_finalized" },
    ]);
    render(<RecordMeasurementPage />);
    await waitFor(() => expect((screen.getByLabelText(/Measurement Book/i) as HTMLElement).tagName).toBe("SELECT"));
    const options = Array.from((screen.getByLabelText(/Measurement Book/i) as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toContain("MB/DRAFT");
    expect(options).not.toContain("MB/SO");
    expect(options).not.toContain("MB/FINAL");
    expect(screen.getByRole("note")).toHaveTextContent("2 measurement books are not listed because they are no longer drafts.");
  });

  it("keeps a book that carries no status (the server decides) and shows no note when none is hidden", async () => {
    stub([{ id: MB_DRAFT, mbNumber: "MB/NOSTATUS" }]);
    render(<RecordMeasurementPage />);
    await waitFor(() => expect((screen.getByLabelText(/Measurement Book/i) as HTMLElement).tagName).toBe("SELECT"));
    expect(screen.getByRole("option", { name: "MB/NOSTATUS" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("a 409 MB_NOT_OPEN from the server reads as a specific message, never the raw code or status", async () => {
    stub(
      [{ id: MB_DRAFT, mbNumber: "MB/DRAFT", status: "draft" }],
      new Response(JSON.stringify({ code: "MB_NOT_OPEN", message: "Cannot record a measurement: measurement book status is 'so_finalized'" }), { status: 409 }),
    );
    render(<RecordMeasurementPage />);
    await waitFor(() => expect((screen.getByLabelText(/Measurement Book/i) as HTMLElement).tagName).toBe("SELECT"));
    await waitFor(() => expect((screen.getByLabelText(/^BoQ Item/i) as HTMLElement).tagName).toBe("SELECT"));
    fireEvent.change(screen.getByLabelText(/Measurement Book/i), { target: { value: MB_DRAFT } });
    fireEvent.change(screen.getByLabelText(/^BoQ Item/i), { target: { value: BOQ } });
    fireEvent.change(await screen.findByLabelText(/^Quantity/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/no longer open for new measurements/i));
    expect(alert.textContent).not.toMatch(/MB_NOT_OPEN|\b409\b/);
  });
});
