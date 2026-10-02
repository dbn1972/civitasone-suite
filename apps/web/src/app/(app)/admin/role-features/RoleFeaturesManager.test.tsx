import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { RoleFeaturesManager } from "./RoleFeaturesManager";
import type { AdminRoleSummary, RoleFeatureGrant } from "@/app/_data/loaders";

const roles: AdminRoleSummary[] = [{ id: "r1", key: "hr_admin", name: "HR Admin", description: null, isSystem: false }];

function ui(grants: RoleFeatureGrant[], opts: { rolesSource?: "api" | "error"; grantsSource?: "api" | "error"; locale?: "en" | "hi" } = {}) {
  const locale = opts.locale ?? "en";
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <RoleFeaturesManager roles={roles} initialGrants={grants} rolesSource={opts.rolesSource ?? "api"} grantsSource={opts.grantsSource ?? "api"} />
    </NextIntlClientProvider>
  );
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

// GAP-ADMIN-ROLE-FEATURES-02
describe("RoleFeaturesManager orphan grants", () => {
  beforeEach(() => vi.restoreAllMocks());

  const grants: RoleFeatureGrant[] = [
    { id: "g1", roleName: "hr_admin", featureKey: "hrms.leave", granted: true },
    { id: "g2", roleName: "hr_admin", featureKey: "legacy.thing", granted: true },
    { id: "g3", roleName: "ghost_role", featureKey: "hrms.leave", granted: true },
  ];

  it("renders a row, with a checked box, for a granted feature that is not in the catalogue", () => {
    render(ui(grants));
    expect(screen.getByText("legacy.thing")).toBeInTheDocument();
    expect(screen.getByText("not in catalogue")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "HR Admin access to legacy.thing" })).toBeChecked();
  });

  it("'Active grants' equals the ticks the matrix can show, and unlisted-role grants are noted separately", () => {
    render(ui(grants));
    const checked = screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked).length;
    expect(screen.getByText("Active grants").parentElement).toHaveTextContent(String(checked));
    expect(checked).toBe(2);
    expect(screen.getByRole("note")).toHaveTextContent("1 more active grant belongs to roles that are not listed");
  });

  it("unchecking an orphan revokes it by its grant id, after confirmation (GAP-ADMIN-ROLE-FEATURES-03)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(ui(grants));
    fireEvent.click(screen.getByRole("checkbox", { name: "HR Admin access to legacy.thing" }));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/policy/role-features/g2");
    expect((spy.mock.calls[0]![1] as RequestInit).method).toBe("DELETE");
  });
});

// GAP-ADMIN-ROLE-FEATURES-03
describe("RoleFeaturesManager confirmation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("an admin.* toggle opens a dialog, sends nothing until Confirm, and Cancel leaves the box unchanged", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "n1" }, 202));
    render(ui([]));
    const box = screen.getByRole("checkbox", { name: "HR Admin access to admin.users" });
    fireEvent.click(box);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("administration feature");
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(box).not.toBeChecked();
    expect(spy).not.toHaveBeenCalled();
  });

  it("confirming a grant POSTs and ticks the box", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "n1" }, 202));
    render(ui([]));
    fireEvent.click(screen.getByRole("checkbox", { name: "HR Admin access to hrms.leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "HR Admin access to hrms.leave" })).toBeChecked());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a 202 with no id triggers a refetch and the box ends checked instead of a false 'Granted'", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") return new Response("", { status: 202 });
      return json({ data: [{ id: "srv1", roleName: "hr_admin", featureKey: "hrms.leave", granted: true }] });
    });
    render(ui([]));
    fireEvent.click(screen.getByRole("checkbox", { name: "HR Admin access to hrms.leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "HR Admin access to hrms.leave" })).toBeChecked());
    expect(spy.mock.calls.some(([u, i]) => String(u) === "/api/proxy/v1/policy/role-features" && !(i as RequestInit | undefined)?.method)).toBe(true);
  });
});

// GAP-ADMIN-ROLE-FEATURES-04
describe("RoleFeaturesManager presets", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reports how many were granted and where it failed, keeping the earlier grants", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      n++;
      return n <= 2 ? json({ id: `g${n}` }, 202) : json({}, 500);
    });
    render(ui([]));
    fireEvent.click(screen.getByRole("button", { name: "Grant all Finance features" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Granted 2 of 4; failed at finance.budget.");
    expect(alert).toHaveTextContent("nothing was rolled back");
    expect(screen.getByRole("checkbox", { name: "HR Admin access to finance.dashboard" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "HR Admin access to finance.vouchers" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "HR Admin access to finance.budget" })).not.toBeChecked();
  });

  it("an all-success preset reports the count", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ id: `g${++n}` }, 202));
    render(ui([]));
    fireEvent.click(screen.getByRole("button", { name: "Grant all HR features" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Granted 3 features"));
  });
});

// GAP-ADMIN-ROLE-FEATURES-05
describe("RoleFeaturesManager preview modal", () => {
  it("Escape closes the preview and focus returns to the Preview button", async () => {
    render(ui([{ id: "g1", roleName: "hr_admin", featureKey: "hrms.leave", granted: true }]));
    const trigger = screen.getByRole("button", { name: /Preview/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("hrms.leave")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

// GAP-ADMIN-ROLE-FEATURES-06
describe("RoleFeaturesManager load failures", () => {
  it("a failed grants fetch disables every checkbox and preset and shows a retry state", () => {
    render(ui([], { grantsSource: "error" }));
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByRole("button", { name: "Grant all Finance features" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/role list/)).not.toBeInTheDocument();
  });

  it("a failed roles fetch names the roles, not the grants, and does not disable editing", () => {
    render(ui([], { rolesSource: "error" }));
    expect(screen.getByRole("status")).toHaveTextContent("role list");
  });

  it("renders translated headings for the hi locale", () => {
    render(ui([], { locale: "hi" }));
    expect(screen.getByRole("heading", { name: hiMessages.roleFeatures.title })).toBeInTheDocument();
  });
});
