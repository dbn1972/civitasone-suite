import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import LeavePoliciesPage from "./page";

const LEAVE_TYPES = [{ id: "lt-1", code: "CL", name: "Casual Leave" }];

function mockFetch(opts: { policies?: unknown[]; createOk?: boolean } = {}) {
  const { policies = [], createOk = true } = opts;
  let policiesCallCount = 0;
  const calls: string[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes("/admin/leave-policies") && (!init || init.method === undefined)) {
      policiesCallCount += 1;
      // Second+ GET (post-create refetch) returns the row that was "created".
      const data = policiesCallCount === 1 ? policies : [...policies, {
        id: "policy-new", leaveTypeCode: "CL", leaveTypeName: "Casual Leave",
        employeeType: "permanent", maxDaysPerYear: 30, carryForward: false,
        maxAccumulation: 0, encashable: false, countMethod: "calendar",
        maxContinuousDays: 365, minServiceMonths: 0, genderRestriction: null,
        requiresMedicalCert: false, requiresMedicalCertAfterDays: 3,
        prefixSuffixRule: false, sandwichRule: false, proRataOnJoining: true,
        isActive: true,
      }];
      return { ok: true, status: 200, json: async () => ({ data }) } as Response;
    }
    if (url.includes("/leave-types")) {
      return { ok: true, status: 200, json: async () => ({ data: LEAVE_TYPES }) } as Response;
    }
    if (url.includes("/admin/leave-policies") && init?.method === "POST") {
      return {
        ok: createOk, status: createOk ? 201 : 500,
        text: async () => (createOk ? JSON.stringify({ id: "policy-new", status: "created" }) : "boom"),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  return { fn, calls };
}

describe("LeavePoliciesPage — create-policy wiring", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the create-policy form when + New Policy is clicked (previously: dead import, never rendered)", async () => {
    const { fn } = mockFetch();
    vi.stubGlobal("fetch", fn);
    render(<LeavePoliciesPage />);

    const openButton = await screen.findByRole("button", { name: "+ New Policy" });
    fireEvent.click(openButton);

    expect(await screen.findByText("New Leave Policy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Policy" })).toBeInTheDocument();
  });

  it("submitting the create form posts the policy fields, confirms, and refreshes the list", async () => {
    const { fn, calls } = mockFetch();
    vi.stubGlobal("fetch", fn);
    render(<LeavePoliciesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "+ New Policy" }));

    // Wait for the async leave-types fetch inside the form to resolve so the
    // (required) Leave Type select is populated rather than empty.
    await waitFor(() => {
      expect(screen.getByText(/CL — Casual Leave/)).toBeInTheDocument();
    });

    // Defaults (employeeType="permanent", maxDaysPerYear="30") already pass
    // validation, so submitting immediately is a valid, minimal-interaction path.
    fireEvent.click(screen.getByRole("button", { name: "Create Policy" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/create a new/i);
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));

    await waitFor(() => {
      const postCall = (fn.mock.calls as [string, RequestInit?][]).find(
        ([url, init]) => url.includes("/admin/leave-policies") && init?.method === "POST",
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body.leaveTypeId).toBe("lt-1");
      expect(body.employeeType).toBe("permanent");
      expect(body.maxDaysPerYear).toBe(30);
    });

    // The list must be re-fetched after a successful create — router.refresh()
    // alone is a no-op for this "use client" page's own useEffect-driven fetch.
    await waitFor(() => {
      const policyGets = calls.filter((u) => u.includes("/admin/leave-policies") && !u.includes("employeeType"));
      expect(policyGets.length).toBeGreaterThanOrEqual(2);
    });
    expect(await screen.findByText(/policy created successfully/i)).toBeInTheDocument();
  });

  it("does not close the form or show a false success toast when the create request fails", async () => {
    const { fn } = mockFetch({ createOk: false });
    vi.stubGlobal("fetch", fn);
    render(<LeavePoliciesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "+ New Policy" }));
    await waitFor(() => expect(screen.getByText(/CL — Casual Leave/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create Policy" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });
    expect(screen.queryByText(/policy created successfully/i)).not.toBeInTheDocument();
    // Form must still be open so the user doesn't lose their entered values.
    expect(screen.getByRole("button", { name: "Create Policy" })).toBeInTheDocument();
  });
});
