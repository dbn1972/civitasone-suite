import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

/**
 * GAP-HR-TRAINING-01: the programme detail page (the target of every "Enroll"
 * link) exists, offers self-enrol to everyone, and offers the "Nominate an
 * employee" picker to HR staff only -- mirroring POST /v1/hrms/nominations,
 * where only HR_ROLES may pick someone other than themselves.
 */
let mockRoles: string[] = ["employee"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));

const getProgramsMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getTrainingPrograms: (...a: unknown[]) => getProgramsMock(...a),
  getMyProfile: (...a: unknown[]) => getMyProfileMock(...a),
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => []),
  resolveEmployees: vi.fn(async () => []),
}));

import TrainingDetailPage from "./page";

function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

const PROGRAM = {
  id: "prog-1", title: "Data Protection Basics", category: "mandatory", mode: "online", enrollmentDeadline: null,
  startDate: "2099-05-04", endDate: "2099-05-06", enrolledCount: 2, maxCapacity: 10, status: "upcoming",
};

beforeEach(() => {
  mockRoles = ["employee"];
  getProgramsMock.mockReset().mockResolvedValue({ data: [PROGRAM], source: "api" });
  getMyProfileMock.mockReset().mockResolvedValue({ data: { id: "emp-self", name: "Self" }, source: "api" });
  fetchJsonMock.mockReset().mockResolvedValue({ data: [], source: "api" });
});

describe("TrainingDetailPage — GAP-HR-TRAINING-01", () => {
  it("renders the programme (the Enroll link target is a real page, not a 404)", async () => {
    await render(TrainingDetailPage({ params: { id: "prog-1" } }));
    expect(screen.getByRole("heading", { name: "Data Protection Basics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enroll me" })).toBeInTheDocument();
  });

  it("an employee gets self-enrol only: no Nominate-an-employee picker", async () => {
    await render(TrainingDetailPage({ params: { id: "prog-1" } }));
    expect(screen.queryByRole("form", { name: "Nominate an employee" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("a manager gets self-enrol only too (the server pins non-HR callers to themselves)", async () => {
    mockRoles = ["manager"];
    await render(TrainingDetailPage({ params: { id: "prog-1" } }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it.each(["hr_admin", "hr_officer", "super_admin"])("%s gets the Nominate-an-employee picker as well as Enroll me", async (role) => {
    mockRoles = [role];
    await render(TrainingDetailPage({ params: { id: "prog-1" } }));
    expect(screen.getByRole("form", { name: "Nominate an employee" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nominate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enroll me" })).toBeInTheDocument();
  });

  it("an HR user with no linked employee record can still nominate, and is not told to 'contact HR'", async () => {
    mockRoles = ["hr_admin"];
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    await render(TrainingDetailPage({ params: { id: "prog-1" } }));
    expect(screen.getByRole("form", { name: "Nominate an employee" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enroll me" })).not.toBeInTheDocument();
    expect(screen.queryByText(/contact HR to enrol/i)).not.toBeInTheDocument();
  });

  it("a non-HR user with no linked record still gets the 'contact HR' explanation", async () => {
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    await render(TrainingDetailPage({ params: { id: "prog-1" } }));
    expect(screen.getByText(/contact HR to enrol/i)).toBeInTheDocument();
  });

  it("neither control is offered for a programme that is full or not upcoming", async () => {
    mockRoles = ["hr_admin"];
    getProgramsMock.mockResolvedValue({ data: [{ ...PROGRAM, enrolledCount: 10 }], source: "api" });
    await render(TrainingDetailPage({ params: { id: "prog-1" } }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enroll me" })).not.toBeInTheDocument();
    expect(screen.getByText(/fully enrolled/i)).toBeInTheDocument();
  });
});
