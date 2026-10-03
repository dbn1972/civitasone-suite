import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../../_components/FinanceActions", () => ({
  SanctionApproveAction: () => <button type="button">Approve sanction</button>,
}));

import { SanctionApprovalPanel } from "./SanctionApprovalPanel";
import { sanctionApprovalMode, normalizeSanctionStatus, SANCTION_APPROVER_ROLES } from "./sanctionApproval";

const noteProps = { subject: "Road repair", dept: "PWD", amountMinor: "100000" };

function mockLinkedFile(file: { id: string; file_no: string; status: string } | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/estab/files/by-ref")) {
      return file ? new Response(JSON.stringify({ data: file }), { status: 200 }) : new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  });
}

describe("SanctionApprovalPanel (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01/-04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("a pending sanction with a linked eFile shows no Approve button, the file number and an Open file link", async () => {
    mockLinkedFile({ id: "f-1", file_no: "EO/FIN/2026/009", status: "in_progress" });
    render(<SanctionApprovalPanel id="s-1" isPending canApprove {...noteProps} />);
    await waitFor(() => expect(screen.getByText(/Awaiting eOffice decision/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve sanction" })).not.toBeInTheDocument();
    expect(screen.getAllByText("EO/FIN/2026/009").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Open file" })[0]).toHaveAttribute("href", "/estab/files/f-1");
  });

  it("an approver on a pending sanction with no eFile sees both routes plus the guidance line", async () => {
    mockLinkedFile(null);
    render(<SanctionApprovalPanel id="s-1" isPending canApprove {...noteProps} />);
    expect(await screen.findByRole("button", { name: "Approve sanction" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raise for approval" })).toBeInTheDocument();
    expect(screen.getByText(/Approve directly .* or route through eOffice file noting/)).toBeInTheDocument();
  });

  it("a non-approver never sees direct Approve, only the eOffice route", async () => {
    mockLinkedFile(null);
    render(<SanctionApprovalPanel id="s-1" isPending canApprove={false} {...noteProps} />);
    expect(await screen.findByText(/Only a finance administrator can approve directly/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve sanction" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raise for approval" })).toBeInTheDocument();
  });

  it("a non-pending sanction shows no approval guidance or Approve button", async () => {
    mockLinkedFile(null);
    render(<SanctionApprovalPanel id="s-1" isPending={false} canApprove {...noteProps} />);
    await screen.findByRole("button", { name: "Raise for approval" });
    expect(screen.queryByRole("button", { name: "Approve sanction" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Approve directly/)).not.toBeInTheDocument();
  });
});

describe("SanctionApprovalPanel with a finished eOffice file (review D3)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(["rejected", "closed", "approved"])("a %s file does not lock the panel: Approve and re-raise stay available", async (status) => {
    mockLinkedFile({ id: "f-1", file_no: "EO/FIN/2026/009", status });
    render(<SanctionApprovalPanel id="s-1" isPending canApprove {...noteProps} />);
    expect(await screen.findByRole("button", { name: "Approve sanction" })).toBeInTheDocument();
    expect(screen.queryByText(/Awaiting eOffice decision/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raise for approval" })).toBeInTheDocument();
    expect(screen.getByText(/did not result in approval/)).toBeInTheDocument();
  });

  it.each(["open", "in_progress", "In Progress", "pending"])("a %s file still locks direct approval", async (status) => {
    mockLinkedFile({ id: "f-1", file_no: "EO/FIN/2026/010", status });
    render(<SanctionApprovalPanel id="s-1" isPending canApprove {...noteProps} />);
    await waitFor(() => expect(screen.getByText(/Awaiting eOffice decision/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve sanction" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raise for approval" })).not.toBeInTheDocument();
  });
});

describe("normalizeSanctionStatus", () => {
  it("maps cancelled to rejected (an eOffice rejection) and leaves others", () => {
    expect(normalizeSanctionStatus("cancelled")).toBe("rejected");
    expect(normalizeSanctionStatus("Cancelled")).toBe("rejected");
    expect(normalizeSanctionStatus("pending")).toBe("pending");
    expect(normalizeSanctionStatus(undefined)).toBe("");
  });
});

describe("sanctionApprovalMode", () => {
  const rejected = { id: "f", file_no: "N", status: "rejected" };
  it("a rejected or closed file is not in flight", () => {
    expect(sanctionApprovalMode({ isPending: true, canApprove: true, loading: false, file: rejected })).toBe("choose");
    expect(sanctionApprovalMode({ isPending: true, canApprove: false, loading: false, file: { ...rejected, status: "closed" } })).toBe("eoffice-only");
  });
});

// GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01 step 6: finance-service's own flag is authoritative
describe("server-side eFile-in-flight flag", () => {
  it("serverInFlight locks direct approval even while the estab lookup is loading or found nothing", () => {
    expect(sanctionApprovalMode({ isPending: true, canApprove: true, loading: true, file: null, serverInFlight: true })).toBe("awaiting-eoffice");
    expect(sanctionApprovalMode({ isPending: true, canApprove: true, loading: false, file: null, serverInFlight: true })).toBe("awaiting-eoffice");
    expect(sanctionApprovalMode({ isPending: false, canApprove: true, loading: false, file: null, serverInFlight: true })).toBe("none");
    expect(sanctionApprovalMode({ isPending: true, canApprove: true, loading: false, file: null, serverInFlight: false })).toBe("choose");
  });

  it("the panel hides Approve and names the file number finance-service recorded, though the estab lookup returned nothing", async () => {
    mockLinkedFile(null);
    render(<SanctionApprovalPanel id="s-1" isPending canApprove efileInFlight efileFileNo="FIN/2031/77" {...noteProps} />);
    expect(await screen.findByText(/Awaiting eOffice decision/)).toBeInTheDocument();
    expect(screen.getByText("FIN/2031/77")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve sanction" })).not.toBeInTheDocument();
    expect(screen.getByText(/Direct approval is unavailable while this file is in flight/)).toBeInTheDocument();
  });

  it("without a file number it still says an eOffice decision is awaited", async () => {
    mockLinkedFile(null);
    render(<SanctionApprovalPanel id="s-1" isPending canApprove efileInFlight {...noteProps} />);
    expect(await screen.findByText(/Awaiting an eOffice decision on this sanction/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve sanction" })).not.toBeInTheDocument();
  });
});

describe("sanctionApprovalMode (base)", () => {
  const file = { id: "f", file_no: "N", status: "open" };
  it("covers every branch", () => {
    expect(sanctionApprovalMode({ isPending: false, canApprove: true, loading: false, file: null })).toBe("none");
    expect(sanctionApprovalMode({ isPending: true, canApprove: true, loading: true, file: null })).toBe("pending-lookup");
    expect(sanctionApprovalMode({ isPending: true, canApprove: true, loading: false, file })).toBe("awaiting-eoffice");
    expect(sanctionApprovalMode({ isPending: true, canApprove: true, loading: false, file: null })).toBe("choose");
    expect(sanctionApprovalMode({ isPending: true, canApprove: false, loading: false, file: null })).toBe("eoffice-only");
  });
  it("direct approval is limited to the roles finance-service accepts", () => {
    expect(SANCTION_APPROVER_ROLES).toEqual(["finance_admin", "super_admin"]);
  });
});
