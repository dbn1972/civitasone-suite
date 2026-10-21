import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const rolesRef = vi.hoisted(() => ({ roles: ["hr_admin"] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesRef.roles }));
const getTrainingProgramsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getTrainingPrograms: () => getTrainingProgramsMock() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import TrainingPage from "./page";

const NEW_ID = "11111111-2222-4333-8444-555555555555";
const program = (id: string) => ({
  id,
  title: `Programme ${id.slice(0, 4)}`,
  category: null,
  mode: null,
  enrollmentDeadline: null,
  trainerName: undefined,
  startDate: "2099-01-01",
  endDate: "2099-01-02",
  venue: undefined,
  enrolledCount: 0,
  maxCapacity: 30,
  status: "upcoming",
});

async function renderPage(searchParams?: { created?: string | string[] }) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await TrainingPage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

describe("TrainingPage ?created= hand-off (GAP-HR-TRAINING-NEW-01)", () => {
  beforeEach(() => {
    getTrainingProgramsMock.mockReset();
    rolesRef.roles = ["hr_admin"];
  });

  it("shows a pending notice while the just-submitted programme is not in the list yet", async () => {
    getTrainingProgramsMock.mockResolvedValue({ data: [program("aaaaaaaa-0000-4000-8000-000000000001")], source: "api" });
    await renderPage({ created: NEW_ID });
    expect(screen.getByText(/still being processed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh now/i })).toBeInTheDocument();
  });

  it("shows the pending notice even when the list is still empty", async () => {
    getTrainingProgramsMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({ created: NEW_ID });
    expect(screen.getByText(/still being processed/i)).toBeInTheDocument();
  });

  it("shows no notice once the programme is in the list", async () => {
    getTrainingProgramsMock.mockResolvedValue({ data: [program(NEW_ID)], source: "api" });
    await renderPage({ created: NEW_ID });
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });

  it("ignores a created value that is not a UUID", async () => {
    getTrainingProgramsMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({ created: "<script>alert(1)</script>" });
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });

  it("shows no notice without the param", async () => {
    getTrainingProgramsMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });

  it("does not claim a pending programme when the list itself errored", async () => {
    getTrainingProgramsMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage({ created: NEW_ID });
    expect(screen.queryByText(/still being processed/i)).not.toBeInTheDocument();
  });
});
