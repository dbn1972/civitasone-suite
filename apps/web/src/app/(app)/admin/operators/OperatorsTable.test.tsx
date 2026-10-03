import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperatorsTable } from "./OperatorsTable";
import { operatorStats, permissionList, toOperatorRows, twoFaState, twoFaTone } from "./operatorRows";
import { useSeededResource } from "@/lib/sync/resource";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const op = (over: Record<string, unknown> = {}) => ({ name: "A", role: "super_admin", lastLogin: "2026-09-30", status: "active", twoFaStatus: "Enabled", permissions: ["a", "b"], ...over });
function seeded(data: Record<string, unknown>[], provenance: "live" | "cached" | "error-no-data") {
  vi.mocked(useSeededResource).mockReturnValue({ data, fromCache: provenance === "cached", offline: false, cachedAt: null, provenance } as never);
}

describe("operator row helpers (GAP-ADMIN-OPERATORS-05/-07)", () => {
  it("2FA not enabled is a warn tone with a text cue", () => {
    expect(twoFaTone("Disabled")).toEqual({ variant: "warn", label: "Not enabled" });
    expect(twoFaTone("Enabled")).toEqual({ variant: "good", label: "Enabled" });
  });
  it("an empty or missing 2FA value is a neutral Unknown, never 'Not enabled' (GAP-ADMIN-OPERATORS-07)", () => {
    expect(twoFaState("")).toBe("unknown");
    expect(twoFaState("pending")).toBe("unknown");
    expect(twoFaTone("")).toEqual({ variant: "mut", label: "Unknown" });
    expect(twoFaState("Off")).toBe("disabled");
    expect(twoFaState("Not Enabled")).toBe("disabled");
  });
  it("the 2FA Enabled stat is null (not 0) when no row states a 2FA value, and counts normally otherwise", () => {
    expect(operatorStats(toOperatorRows([op({ twoFaStatus: "" }), op({ twoFaStatus: undefined })])).twoFa).toBeNull();
    expect(operatorStats(toOperatorRows([op({ twoFaStatus: "" }), op()])).twoFa).toBe(1);
  });
  it("permissions split into chips from a list or a delimited string", () => {
    expect(permissionList(["x", " y "])).toEqual(["x", "y"]);
    expect(permissionList("x, y;z")).toEqual(["x", "y", "z"]);
  });
  it("stats count 2FA from the same rows", () => {
    expect(operatorStats(toOperatorRows([op(), op({ twoFaStatus: "Disabled" })])).twoFa).toBe(1);
  });
});

describe("OperatorsTable (GAP-ADMIN-OPERATORS-03/-04)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cached rows with empty server list: Total Operators equals the table rows", () => {
    seeded([op({ name: "A" }), op({ name: "B" })], "cached");
    render(<OperatorsTable operators={[]} />);
    expect(screen.getByText("Total Operators").parentElement).toHaveTextContent("2");
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("failure with no cache: dashes + retry (never 'Suspended 0')", () => {
    seeded([], "error-no-data");
    render(<OperatorsTable operators={[]} source="error" errorStatus={500} />);
    expect(screen.getByText("Suspended").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No operators")).not.toBeInTheDocument();
  });

  it("renders a row without a 2FA value as Unknown and the card as an em dash", () => {
    seeded([op({ twoFaStatus: "" })], "live");
    render(<OperatorsTable operators={[]} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByText("Not Enabled")).not.toBeInTheDocument();
    expect(screen.getByText("2FA Enabled").parentElement).toHaveTextContent("—");
  });

  it("renders 2FA 'Not enabled' as text, and permissions as separate chips", () => {
    seeded([op({ twoFaStatus: "Disabled", permissions: ["tenants.read", "tenants.write"] })], "live");
    render(<OperatorsTable operators={[]} />);
    expect(screen.getByText("Not Enabled")).toBeInTheDocument();
    expect(screen.getByText("tenants.read")).toBeInTheDocument();
    expect(screen.getByText("tenants.write")).toBeInTheDocument();
  });
});

// GAP-ADMIN-OPERATORS-06

describe("OperatorsTable audited export (GAP-ADMIN-OPERATORS-06)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

  it("no Export button without the permission", () => {
    seeded([op()], "live");
    render(<OperatorsTable operators={[]} />);
    expect(screen.queryByText("⬇ CSV")).not.toBeInTheDocument();
  });

  it("export posts exactly one audit record with the row count BEFORE the file, and omits last login", async () => {
    seeded([op({ name: "=cmd|calc" }), op({ name: "B" })], "live");
    const order: string[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { order.push("file"); blobs.push(b); return "blob:x"; }); URL.revokeObjectURL = vi.fn();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { order.push("audit"); return new Response("{}", { status: 202 }); });
    render(<OperatorsTable operators={[]} canExport />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(order).toEqual(["audit", "file"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe("/api/proxy/v1/admin/platform-exports/audit");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ resource: "operators", rowCount: 2, filtered: false });
    const text = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsText(blobs[0]!); });
    expect(text.split("\n")[0]).toBe("Name,Role,Account status,2FA,Permissions");
    expect(text).not.toContain("2026-09-30");
    // A cell beginning with "=" is neutralised so a spreadsheet does not evaluate it.
    expect(text).toContain("'=cmd|calc");
  });

  it("a failed audit means no file and a visible reason", async () => {
    seeded([op()], "live");
    const created = vi.fn(() => "blob:x");
    URL.createObjectURL = created; URL.revokeObjectURL = vi.fn();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    render(<OperatorsTable operators={[]} canExport />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no file was created/));
    expect(created).not.toHaveBeenCalled();
  });
});

describe("OperatorsTable change requests (GAP-ADMIN-OPERATORS-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))));
  });

  it("adds an Actions column and the approvals panel only for a manager, and hides your own row's actions", async () => {
    const ME = "11111111-1111-4111-8111-111111111111";
    seeded([op({ id: ME, name: "Me" }), op({ id: "22222222-2222-4222-8222-222222222222", name: "Other Op" })], "live");
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OperatorsTable operators={[]} canManage viewerId={ME} viewerRoles={["super_admin"]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Suspend: Other Op" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend: Me" })).not.toBeInTheDocument();
    expect(await screen.findByText("Nothing is waiting for approval.")).toBeInTheDocument();
  });

  it("is read-only without canManage", () => {
    seeded([op({ id: "22222222-2222-4222-8222-222222222222", name: "Other Op" })], "live");
    render(<OperatorsTable operators={[]} />);
    expect(screen.queryByRole("button", { name: /Suspend/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Change requests")).not.toBeInTheDocument();
  });
});
