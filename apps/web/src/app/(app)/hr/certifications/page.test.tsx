import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const rolesRef = vi.hoisted(() => ({ roles: ["hr_admin"] as string[] }));
// Role admission itself is covered in ../pageGates.test.tsx; this suite tests rendering.
vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: () => {},
  getSessionRoles: () => rolesRef.roles,
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import CertificationsPage from "./page";

const ROWS = [
  {
    id: "c1",
    employee: "Priya Nair",
    department: "Finance",
    certification: "Cyber Security Awareness",
    issuingBody: "NIC",
    trainingId: "t1",
    issuedDate: "2025-09-15",
    expiryDate: null,
  },
  {
    id: "c2",
    employee: "Arjun Rao",
    department: "Establishment",
    certification: "Project Management",
    issuingBody: "Internal",
    trainingId: null,
    issuedDate: "2025-10-01",
    expiryDate: null,
  },
];

async function renderPage() {
  fetchJsonMock.mockImplementation(
    async (_url: string, _fallback: unknown, o?: { mapResponse?: (p: unknown) => unknown }) => ({
      data: o?.mapResponse?.({ data: ROWS }),
      source: "api",
    }),
  );
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await CertificationsPage()}
    </NextIntlClientProvider>,
  );
}

describe("CertificationsPage holder names (GAP-HR-CERTIFICATIONS-02)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesRef.roles = ["hr_admin"];
  });

  it("HR sees who holds each certificate", async () => {
    await renderPage();
    const holders = screen.getAllByTestId("certification-holder").map((el) => el.textContent);
    expect(holders).toHaveLength(2);
    expect(holders.join("|")).toContain("Priya Nair");
    expect(holders.join("|")).toContain("Finance");
    expect(holders.join("|")).toContain("Arjun Rao");
    expect(holders.join("|")).toContain("Establishment");
  });

  it("a manager (whose list is self + reports) also sees holder names", async () => {
    rolesRef.roles = ["manager"];
    await renderPage();
    expect(screen.getAllByTestId("certification-holder")).toHaveLength(2);
  });

  it("a bare employee (own certificates only) gets no holder line", async () => {
    rolesRef.roles = ["employee"];
    await renderPage();
    expect(screen.queryByTestId("certification-holder")).not.toBeInTheDocument();
    expect(screen.getByText("Cyber Security Awareness")).toBeInTheDocument();
  });
});
