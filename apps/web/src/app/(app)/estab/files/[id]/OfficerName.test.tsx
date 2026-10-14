import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { IntlWrapper } from "@/lib/testUtils/intl";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: IntlWrapper });

import { OfficerName, __resetOfficerMapsCacheForTest } from "./OfficerName";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const OP_ID = "11111111-1111-4111-8111-111111111111";

describe("OfficerName — DPDP data minimisation (DETAIL-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOfficerMapsCacheForTest();
  });

  it("resolves the name from the operator roster and NEVER fetches the /hrms/employees directory", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      urls.push(url);
      if (url.includes("/estab/operators")) {
        return Promise.resolve(
          jsonResponse({ data: [{ employeeId: OP_ID, division: "Admin", deskRole: "section_officer", employeeName: "Asha Rao" }] }),
        );
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    render(<OfficerName id={OP_ID} />);

    await waitFor(() => expect(screen.getByText(/Asha Rao/)).toBeInTheDocument());
    // The over-fetching HR directory call must NOT be made.
    expect(urls.some((u) => u.includes("/hrms/employees"))).toBe(false);
  });

  it("does not permanently cache a failed first load — a later mount recovers the name", async () => {
    // First mount: operators 500 → empty maps, "Unknown employee" (never an id fragment).
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) return Promise.resolve(jsonResponse({ message: "boom" }, 500));
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    const first = render(<OfficerName id={OP_ID} />);
    await waitFor(() => expect(screen.getByText("Unknown employee")).toBeInTheDocument());
    expect(screen.queryByText(/11111111/)).not.toBeInTheDocument();
    first.unmount();

    // Second mount: operators OK now → name resolves (failure was NOT cached).
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) {
        return Promise.resolve(
          jsonResponse({ data: [{ employeeId: OP_ID, division: "Admin", deskRole: "section_officer", employeeName: "Asha Rao" }] }),
        );
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });

    render(<OfficerName id={OP_ID} />);
    await waitFor(() => expect(screen.getByText(/Asha Rao/)).toBeInTheDocument());
  });
});
