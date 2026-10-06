import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { ApplyForm } from "./ApplyForm";

const GRANTEES = [
  { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", label: "District Panchayat, Nashik", sublabel: "GR-001" },
];

function renderForm(overrides?: Partial<React.ComponentProps<typeof ApplyForm>>) {
  return render(
    <ApplyForm
      schemeId="scheme-1"
      schemeName="PM Scheme"
      minAmountMinor={0}
      maxAmountMinor={0}
      budgetMinor={100000000}
      windowHint={null}
      grantees={GRANTEES}
      {...overrides}
    />,
  );
}

async function pickGrantee() {
  const picker = screen.getByLabelText("Grantee");
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: "Nashik" } });
  const option = await screen.findByText("District Panchayat, Nashik");
  fireEvent.mouseDown(option);
}

describe("ApplyForm (grant application)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // GAP-GRANTS-SCHEMES-DETAIL-APPLY-01/02: selecting a grantee submits its UUID;
  // the success panel links to the returned application id.
  it("submits the selected grantee UUID and shows the new application reference", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "app-123" }), { status: 201 }));

    renderForm();
    await pickGrantee();
    fireEvent.change(screen.getByLabelText(/project purpose/i), {
      target: { value: "Construction of a new anganwadi centre building." },
    });
    fireEvent.change(screen.getByLabelText(/requested amount/i), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/schemes/scheme-1/applications");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.beneficiaryId).toBe(GRANTEES[0].id);
    expect(body.amountRequestedMinor).toBe(50000000);
    expect(await screen.findByText(/app-123/)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "View application" })).toHaveAttribute(
      "href",
      "/grants/applications/app-123",
    );
  });

  // GAP-GRANTS-SCHEMES-DETAIL-APPLY-05: >2 decimals rejected, no POST.
  it("rejects an amount with more than two decimals", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));
    renderForm();
    await pickGrantee();
    fireEvent.change(screen.getByLabelText(/project purpose/i), {
      target: { value: "A valid purpose string of enough length." },
    });
    fireEvent.change(screen.getByLabelText(/requested amount/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid amount/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-GRANTS-SCHEMES-DETAIL-APPLY-03: amount above the scheme max is blocked.
  it("rejects an amount above the scheme maximum", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));
    renderForm({ maxAmountMinor: 10000000 }); // ₹100000 cap
    await pickGrantee();
    fireEvent.change(screen.getByLabelText(/project purpose/i), {
      target: { value: "A valid purpose string of enough length." },
    });
    fireEvent.change(screen.getByLabelText(/requested amount/i), { target: { value: "200000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/exceeds the scheme maximum/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a grantee to be selected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 201 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/project purpose/i), {
      target: { value: "A valid purpose string of enough length." },
    });
    fireEvent.change(screen.getByLabelText(/requested amount/i), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/select a grantee/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows a clerk-safe error, not the raw server text, on a failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("grant-service: scheme budget exhausted for FY26", { status: 422 }),
    );
    renderForm();
    await pickGrantee();
    fireEvent.change(screen.getByLabelText(/project purpose/i), {
      target: { value: "Construction of a new anganwadi centre building." },
    });
    fireEvent.change(screen.getByLabelText(/requested amount/i), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Application" }));

    expect(
      await screen.findByText(/Some details weren't accepted\. Check what you entered and try again\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/budget exhausted/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

// GAP-GRANTS-SCHEMES-DETAIL-APPLY-03: the server page blocks a closed scheme.
describe("ApplyPage (window gating)", () => {
  const getSchemeByIdMock = vi.fn();
  const getGranteesMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    getSchemeByIdMock.mockReset();
    getGranteesMock.mockReset();
    getGranteesMock.mockResolvedValue({ data: [], source: "api" });
  });

  async function loadPage() {
    vi.doMock("../../../_data", () => ({
      getSchemeById: (id: string) => getSchemeByIdMock(id),
    }));
    vi.doMock("@/app/_data/loaders", () => ({
      getGrantees: () => getGranteesMock(),
    }));
    const mod = await import("./page");
    return mod.default;
  }

  it("shows a closed state for a scheme past its close date", async () => {
    getSchemeByIdMock.mockResolvedValue({
      data: {
        id: "scheme-1",
        code: "C1",
        name: "Old Scheme",
        status: "open",
        budgetMinor: 100,
        disbursedMinor: 0,
        minAmountMinor: 0,
        maxAmountMinor: 0,
        currency: "INR",
        openAt: "2020-01-01",
        closeAt: "2020-12-31",
      },
      source: "api",
    });
    const ApplyPage = await loadPage();
    render(await ApplyPage({ params: { id: "scheme-1" } }));
    expect(screen.getByText(/Applications are closed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit Application" })).not.toBeInTheDocument();
  });
});
