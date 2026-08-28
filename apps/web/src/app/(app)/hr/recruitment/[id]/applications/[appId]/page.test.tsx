import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "job-1", appId: "app-2" }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import ApplicationDetailPage from "./page";

const LIST_RESPONSE = {
  data: [
    { id: "app-1", applicantName: "Asha Verma", stage: "applied", screeningDecision: "pending", source: "public", appliedAt: "2026-08-01" },
    { id: "app-2", applicantName: "Rahul Singh", stage: "selected", screeningDecision: "eligible", source: "public", appliedAt: "2026-08-02", email: "rahul@example.com" },
  ],
};

describe("ApplicationDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the application via the job-opening's applications list, not the nonexistent singular GET", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/proxy/v1/hrms/job-openings/job-1/applications") {
        return { ok: true, status: 200, json: async () => LIST_RESPONSE } as Response;
      }
      // GET /v1/hrms/applications/:id does not exist (confirmed 404 live) — if the
      // page ever calls it again, fail the test loudly instead of pretending it works.
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApplicationDetailPage />);

    expect(await screen.findByRole("heading", { name: "Rahul Singh" })).toBeInTheDocument();
    expect(screen.getByText("Screening decision")).toBeInTheDocument();
    expect(screen.getByText("eligible")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/job-openings/job-1/applications");
  });

  it("shows a clean not-found state when the id isn't in the pipeline, with a working way back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) } as Response)));
    render(<ApplicationDetailPage />);

    expect(await screen.findByText("Application not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute("href", "/hr/recruitment/job-1");
  });

  it("links back to the job opening detail page, not the broken relative '.' (which 404s under this nested route)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => LIST_RESPONSE } as Response)));
    render(<ApplicationDetailPage />);
    await screen.findByRole("heading", { name: "Rahul Singh" });
    expect(screen.getByRole("link", { name: /back/i })).toHaveAttribute("href", "/hr/recruitment/job-1");
  });

  it("hides the Hire action once a hire has been initiated, so it can't be double-submitted", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/proxy/v1/hrms/job-openings/job-1/applications") {
        return { ok: true, status: 200, json: async () => LIST_RESPONSE } as Response;
      }
      if (url === "/api/proxy/v1/hrms/applications/app-2/hire" && init?.method === "POST") {
        return { ok: true, status: 202, text: async () => "{}" } as Response;
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApplicationDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hire" }));

    fireEvent.change(screen.getByLabelText(/employee no/i), { target: { value: "EMP-2026-001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText(/department id/i), { target: { value: "dept-1" } });
    fireEvent.change(screen.getByLabelText(/designation id/i), { target: { value: "desig-1" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm hire/i }));

    await waitFor(() => {
      expect(screen.getByText(/hire initiated/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Hire" })).not.toBeInTheDocument();
  });
});
