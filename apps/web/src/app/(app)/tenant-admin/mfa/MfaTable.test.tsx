import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: pushMock }),
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, seed: unknown, source: string) => ({
    data: seed,
    provenance: source === "error" ? "error-no-data" : "live",
    offline: false,
    cachedAt: null,
  }),
}));

const getMfaUsersMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getMfaUsers: (...a: unknown[]) => getMfaUsersMock(...a),
}));

import MfaManagementPage from "./page";
import { MfaTable } from "./MfaTable";

type U = { id: string; name: string; email: string; department: string; mfaStatus: string; enrolledAt: string | null };
function u(partial: Partial<U> & Pick<U, "id" | "mfaStatus">): U {
  return { name: "N", email: "a@b.gov.in", department: "", enrolledAt: null, ...partial };
}

describe("MfaManagementPage — GAP-TENANT-ADMIN-MFA-02", () => {
  beforeEach(() => getMfaUsersMock.mockReset());

  it("counts the real enum (enabled/disabled) and KPIs sum to Total", async () => {
    getMfaUsersMock.mockResolvedValue({
      data: [
        u({ id: "1", mfaStatus: "enabled" }),
        u({ id: "2", mfaStatus: "enabled" }),
        u({ id: "3", mfaStatus: "disabled" }),
        u({ id: "4", mfaStatus: "disabled" }),
        u({ id: "5", mfaStatus: "disabled" }),
      ],
      source: "api",
    });
    render(await MfaManagementPage());
    const stat = (label: string | RegExp) =>
      screen.getAllByText(label).map((e) => e.closest(".stat")).find(Boolean) as HTMLElement;
    expect(stat("Total Users")).toHaveTextContent("5");
    expect(stat("Enrolled")).toHaveTextContent("2");
    expect(stat(/^Not enrolled/)).toHaveTextContent("3");
    // 2 enrolled of 5 = 40% enrolled, 60% not enrolled
    expect(stat(/^Not enrolled/)).toHaveTextContent("60%");
  });

  it("does not report every user as unenrolled when the enum is 'enabled' (old code counted 'active')", async () => {
    getMfaUsersMock.mockResolvedValue({
      data: [u({ id: "1", mfaStatus: "enabled" })],
      source: "api",
    });
    render(await MfaManagementPage());
    const stat = (label: string | RegExp) =>
      screen.getAllByText(label).map((e) => e.closest(".stat")).find(Boolean) as HTMLElement;
    expect(stat("Enrolled")).toHaveTextContent("1");
  });

  // GAP-TENANT-ADMIN-MFA-01: subtitle no longer promises controls it lacks.
  it("subtitle does not claim 'controls'", async () => {
    getMfaUsersMock.mockResolvedValue({ data: [], source: "api" });
    render(await MfaManagementPage());
    expect(screen.queryByText(/user-level MFA controls/i)).not.toBeInTheDocument();
  });
});

describe("MfaTable — GAP-TENANT-ADMIN-MFA-01/03/04", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  const rows: U[] = [
    u({ id: "u1", name: "Asha", email: "asha@dept.gov.in", mfaStatus: "enabled" }),
    u({ id: "u2", name: "Bimal", email: "bimal@dept.gov.in", mfaStatus: "disabled" }),
  ];

  // GAP-TENANT-ADMIN-MFA-01
  it("a row navigates to the user's security page", () => {
    render(<MfaTable users={rows} source="api" />);
    const cell = screen.getByText("Asha");
    const tr = cell.closest("tr")!;
    fireEvent.click(tr);
    expect(pushMock).toHaveBeenCalledWith("/tenant-admin/users/u1");
  });

  // GAP-TENANT-ADMIN-MFA-03
  it("renders the email masked, never the full address", () => {
    render(<MfaTable users={rows} source="api" />);
    expect(screen.queryByText("asha@dept.gov.in")).not.toBeInTheDocument();
    expect(screen.getByText(/a\*+@d/)).toBeInTheDocument();
  });

  // GAP-TENANT-ADMIN-MFA-03
  it("CSV export calls the audit guard before building a file; a failed guard blocks download", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
    render(<MfaTable users={rows} source="api" />);
    // open export (exportConfirm dialog), then confirm
    fireEvent.click(screen.getByRole("button", { name: /CSV/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Export$/ }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/v1/admin/mfa-exports/audit", expect.objectContaining({ method: "POST" })),
    );
    await waitFor(() => expect(screen.getByText(/Couldn't record this export/i)).toBeInTheDocument());
  });

  // GAP-TENANT-ADMIN-MFA-04
  it("maps enum values to consistent labels (Enrolled / Not enrolled)", () => {
    render(<MfaTable users={rows} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Enrolled")).toBeInTheDocument();
    expect(within(table).getByText("Not enrolled")).toBeInTheDocument();
    // the raw enum word is not shown
    expect(within(table).queryByText("enabled")).not.toBeInTheDocument();
    expect(within(table).queryByText("disabled")).not.toBeInTheDocument();
  });
});
