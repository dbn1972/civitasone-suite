import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { IntlWrapper } from "@/lib/testUtils/intl";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: IntlWrapper });

import { OfficerName, __resetOfficerMapsCacheForTest } from "./OfficerName";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("OfficerName — batched resolve for ids beyond the roster (GAP-ESTAB-FILES-DETAIL-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("Given three officers on screen the roster cannot name, Then ONE resolve request carries all three ids and names appear", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      urls.push(url);
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/estab/officers/resolve")) {
        return Promise.resolve(jsonResponse({ data: [
          { id: A, displayName: "Asha Rao" }, { id: B, displayName: "Bimal Das" },
        ] }));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    render(<><span><OfficerName id={A} /></span><span><OfficerName id={B} /></span><span><OfficerName id={C} /></span></>);

    await waitFor(() => expect(screen.getByText("Asha Rao")).toBeInTheDocument());
    expect(screen.getByText("Bimal Das")).toBeInTheDocument();
    expect(screen.getByText("Unknown employee")).toBeInTheDocument(); // C: confirmed miss, never an id
    const resolves = urls.filter((u) => u.includes("/estab/officers/resolve"));
    expect(resolves).toHaveLength(1);
    for (const id of [A, B, C]) expect(resolves[0]).toContain(id);
    expect(urls.some((u) => u.includes("/hrms/employees"))).toBe(false);
    expect(document.body.textContent).not.toMatch(/aaaaaaaa|bbbbbbbb|cccccccc/);
  });

  it("Given the resolve request fails, Then the label stays Unknown employee and the failure is retried on the next mount", async () => {
    let resolveOk = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ data: [{ employeeId: C, division: "X", deskRole: "director" }] }));
      if (url.includes("/estab/officers/resolve")) {
        return Promise.resolve(resolveOk ? jsonResponse({ data: [{ id: A, displayName: "Asha Rao" }] }) : jsonResponse({ message: "boom" }, 500));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });

    const first = render(<OfficerName id={A} />);
    await waitFor(() => expect(screen.getByText("Unknown employee")).toBeInTheDocument());
    first.unmount();

    resolveOk = true;
    render(<OfficerName id={A} />);
    await waitFor(() => expect(screen.getByText("Asha Rao")).toBeInTheDocument());
  });
});
