import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { OperatorsTable } from "./OperatorsTable";
import { operatorStats, permissionList, toOperatorRows, twoFaState, twoFaTone } from "./operatorRows";
import { useSeededResource } from "@/lib/sync/resource";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

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
