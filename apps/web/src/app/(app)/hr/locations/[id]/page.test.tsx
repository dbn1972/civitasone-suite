import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

class NotFoundSignal extends Error {}
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("next/navigation")),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));

import LocationDetailPage from "./page";

const loc = (over: Record<string, unknown> = {}) => ({
  id: "L2", name: "Block Office", type: "block", addressLine: "Main Road", city: "Pune", postalCode: "411001",
  lgdCode: "123", parentId: "L1", status: "active", ...over,
});
const hierarchy = {
  location: loc(),
  ancestors: [loc({ id: "L0", name: "Maharashtra", type: "state", parentId: null }), loc({ id: "L1", name: "Pune District", type: "district", parentId: "L0" })],
  children: [loc({ id: "L3", name: "Ward 5", type: "ward", parentId: "L2" })],
  descendantIds: ["L3"],
};
const employees = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  data: { data: rows, total: rows.length, limit: 25, offset: 0, unlinkedCount: 0, ...over },
  source: "api",
});
const emp = (id: string, name: string) => ({ id, employeeNo: `E-${id}`, name, designation: "Clerk", department: "Revenue", status: "confirmed" });

function route(hier: unknown, emps: unknown) {
  fetchJsonMock.mockImplementation(async (path?: string) => {
    // Unrelated shell components (help/session widgets) also read through fetchJson.
    if (typeof path !== "string") return { data: [], source: "api" };
    return path.includes("/hierarchy") ? hier : emps;
  });
}

async function renderPage(sp: Record<string, string> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await LocationDetailPage({ params: { id: "L2" }, searchParams: sp })}
    </NextIntlClientProvider>,
  );
}

describe("/hr/locations/[id]", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders header, breadcrumb, sub-locations and employee rows linking to the profile", async () => {
    route({ data: hierarchy, source: "api" }, employees([emp("e1", "Asha Rao"), emp("e2", "Bimal Das")]));
    await renderPage();
    expect(screen.getByRole("heading", { name: "Block Office" })).toBeInTheDocument();
    expect(screen.getByText("Main Road, Pune, 411001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pune District" })).toHaveAttribute("href", "/hr/locations/L1");
    expect(screen.getByRole("link", { name: "Ward 5" })).toHaveAttribute("href", "/hr/locations/L3");
    expect(screen.getByRole("link", { name: "Asha Rao" })).toHaveAttribute("href", "/hr/employees/e1");
    expect(screen.getByRole("link", { name: "Bimal Das" })).toHaveAttribute("href", "/hr/employees/e2");
    expect(screen.getByText("Employees (2)")).toBeInTheDocument();
  });

  it("forwards search, status and the include-sub-locations toggle to the employees API", async () => {
    route({ data: hierarchy, source: "api" }, employees([emp("e1", "Asha Rao")]));
    await renderPage({ sub: "1", q: "asha", status: "all", page: "1" });
    const url = fetchJsonMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes("/hrms/locations/"))!;
    expect(url).toContain("/api/v1/hrms/locations/L2/employees?");
    expect(url).toContain("includeSubLocations=true");
    expect(url).toContain("q=asha");
    expect(url).toContain("status=all");
    expect(url).toContain("offset=25");
    expect(screen.getByLabelText("Include sub-locations")).toBeChecked();
  });

  it("shows the empty state (not an error) when nobody is assigned", async () => {
    route({ data: hierarchy, source: "api" }, employees([]));
    await renderPage();
    expect(screen.getByText("No employees assigned")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  it("shows 'no matching employees' under an active search", async () => {
    route({ data: hierarchy, source: "api" }, employees([]));
    await renderPage({ q: "zzz" });
    expect(screen.getByText("No matching employees")).toBeInTheDocument();
    expect(screen.queryByText("No employees assigned")).not.toBeInTheDocument();
  });

  it("shows an error state, never the empty state, when the employee fetch fails, and keeps the header", async () => {
    route({ data: hierarchy, source: "api" }, { data: { data: [], total: 0, limit: 25, offset: 0, unlinkedCount: 0 }, source: "error", status: 500 });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Block Office" })).toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText("No employees assigned")).not.toBeInTheDocument();
  });

  it("shows the access-restricted message on a 403 from the employees API", async () => {
    route({ data: hierarchy, source: "api" }, { data: { data: [], total: 0, limit: 25, offset: 0, unlinkedCount: 0 }, source: "error", status: 403, errorMessage: "requires one of: hr_admin, hr_officer, super_admin" });
    await renderPage();
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    expect(screen.queryByText(/hr_admin/)).not.toBeInTheDocument();
  });

  it("404 from the hierarchy call renders not-found; other failures render the error state", async () => {
    route({ data: null, source: "error", status: 404 }, employees([]));
    await expect(renderPage()).rejects.toBeInstanceOf(NotFoundSignal);
    route({ data: null, source: "error", status: 500 }, employees([]));
    await renderPage();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  it("notes (organisation-wide) employees whose location is free text only, on a top-level location", async () => {
    const top = { ...hierarchy, location: loc({ parentId: null }), ancestors: [] };
    route({ data: top, source: "api" }, employees([emp("e1", "Asha Rao")], { unlinkedCount: 3 }));
    await renderPage();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("3 employees have a location entered as free text");
    expect(note).toHaveTextContent("organisation-wide");
  });

  it("does not show the organisation-wide unlinked note on a sub-location page", async () => {
    route({ data: hierarchy, source: "api" }, employees([emp("e1", "Asha Rao")], { unlinkedCount: 3 }));
    await renderPage();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("omits the note when there are none, and paginates beyond one page", async () => {
    route({ data: hierarchy, source: "api" }, employees([emp("e1", "Asha Rao")], { total: 60 }));
    await renderPage({ page: "1" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 26-50 of 60")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/hr/locations/L2?page=2");
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/hr/locations/L2");
  });

  it("has a Hindi string for every English key, with matching placeholders", () => {
    const en = (enMessages as unknown as Record<string, Record<string, string>>).locationDetail!;
    const hi = (hiMessages as unknown as Record<string, Record<string, string>>).locationDetail!;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    const names = (v: string) => [...v.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect(names(hi[k]!), k).toEqual(names(en[k]!));
  });
});
