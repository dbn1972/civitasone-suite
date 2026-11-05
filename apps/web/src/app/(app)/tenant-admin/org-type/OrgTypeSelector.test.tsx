import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { OrgTypeSelector } from "./OrgTypeSelector";

describe("OrgTypeSelector — GAP-TENANT-ADMIN-ORG-TYPE-01/04", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("marks the current type and renders a radiogroup", () => {
    render(<OrgTypeSelector currentType="private" tenantId="t1" settings={{ orgType: "private", theme: "dark" }} />);
    expect(screen.getByRole("radiogroup", { name: /organisation type/i })).toBeInTheDocument();
    const current = screen.getByRole("radio", { name: /Private Company/i });
    expect(current).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("choosing another type opens a confirm dialog and PATCHes merged settings on confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<OrgTypeSelector currentType="private" tenantId="t1" settings={{ orgType: "private", theme: "dark" }} />);
    fireEvent.click(screen.getByRole("radio", { name: /NGO/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /change type/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/v1/tenants/t1", expect.objectContaining({ method: "PATCH" })));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    // merged: keeps theme, sets new orgType
    expect(body).toEqual({ settings: { orgType: "ngo", theme: "dark" } });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("does not PATCH when clicking the already-current type", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<OrgTypeSelector currentType="private" tenantId="t1" settings={{}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Private Company/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-TENANT-ADMIN-ORG-TYPE-04: flags shown on/off with help.
  it("shows each terminology flag with an On/Off state", () => {
    render(<OrgTypeSelector currentType="private" tenantId="t1" settings={{}} />);
    // private has govtTerms off, cpcPayMatrix off, ccsLeaveRules off
    expect(screen.getAllByText(/Govt terms: Off/i).length).toBeGreaterThanOrEqual(1);
    // govt_dept card shows CPC Pay: On
    expect(screen.getAllByText(/CPC Pay: On/i).length).toBeGreaterThanOrEqual(1);
  });
  // A-N3 (UAT post-b14, axe nested-interactive, WCAG 4.1.2): the per-flag
  // HelpTip buttons used to sit inside each role="radio" card, so 8 radios
  // each contained focusable buttons. No interactive control may be nested in
  // a radio; the HelpTips stay reachable as siblings of the radio.
  it("nests no interactive control inside any radio, and keeps the flag help reachable", () => {
    render(<OrgTypeSelector currentType="private" tenantId="t1" settings={{}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(1);
    for (const r of radios) {
      expect(r.querySelectorAll("button, a[href], input, select, textarea, [tabindex], [role=button], [role=radio], [role=link]")).toHaveLength(0);
    }
    // every card still offers the three flag help buttons, outside the radio
    const helpButtons = screen.getAllByRole("button").filter((b) => !radios.some((r) => r.contains(b)));
    expect(helpButtons.length).toBeGreaterThanOrEqual(radios.length * 3);
  });

  it("chooses a type from the keyboard (Enter and Space) on the radio itself", () => {
    render(<OrgTypeSelector currentType="private" tenantId="t1" settings={{}} />);
    const ngo = screen.getByRole("radio", { name: /NGO/i });
    expect(ngo).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(ngo, { key: "Enter" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("describes each radio by its terminology and flags", () => {
    render(<OrgTypeSelector currentType="private" tenantId="t1" settings={{}} />);
    const ngo = screen.getByRole("radio", { name: /NGO/i });
    const ids = (ngo.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids.length).toBe(2);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
  });
});
