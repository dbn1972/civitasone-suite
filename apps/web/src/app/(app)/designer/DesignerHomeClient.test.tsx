import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesignerHomeClient } from "./DesignerHomeClient";
import type { DesignerServiceRow, DomainPackRow } from "./_data/designerLoader";

// RefreshErrorState uses next/navigation (router.refresh).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const draftRow: DesignerServiceRow = {
  id: "s1",
  serviceKey: "trade-license",
  name: "Trade License",
  servicePattern: "certificate",
  ownerDepartment: "Revenue",
  version: 1,
  status: "draft",
  updatedAt: "2026-09-01T00:00:00Z",
};

const publishedRow: DesignerServiceRow = {
  id: "s2",
  serviceKey: "birth-cert",
  name: "Birth Certificate",
  servicePattern: "certificate",
  ownerDepartment: "Health",
  version: 2,
  status: "published",
  updatedAt: "2026-08-15T00:00:00Z",
};

const rejectedRow: DesignerServiceRow = {
  id: "s3",
  serviceKey: "grievance-pgr",
  name: "Grievance PGR",
  servicePattern: "grievance",
  ownerDepartment: "Municipal",
  version: 1,
  status: "rejected",
  updatedAt: "2026-09-10T00:00:00Z",
};

const bookingRow: DesignerServiceRow = {
  id: "s4",
  serviceKey: "hall-booking",
  name: "Hall Booking",
  servicePattern: "booking",
  ownerDepartment: "Municipal",
  version: 1,
  status: "draft",
  updatedAt: "2026-09-12T00:00:00Z",
};

const samplePacks: DomainPackRow[] = [];

describe("DesignerHomeClient", () => {
  // ── GAP-DESIGNER-HOME-01: FAILMASK guard ─────────────────────────────
  describe("GAP-DESIGNER-HOME-01: error source handling", () => {
    it("shows RefreshErrorState (retry button) when servicesSource is error", () => {
      render(
        <DesignerHomeClient
          services={[]}
          domainPacks={samplePacks}
          servicesSource="error"
        />,
      );
      // Should show a retry/error message, not the "No services yet" empty state.
      expect(screen.queryByText("No services yet")).toBeNull();
      expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
    });

    it("shows dash '—' in all stat cards when servicesSource is error", () => {
      render(
        <DesignerHomeClient
          services={[]}
          domainPacks={samplePacks}
          servicesSource="error"
        />,
      );
      // All four stat cards should show "—", not "0".
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(4);
    });

    it("shows real counts and data table when servicesSource is api", () => {
      render(
        <DesignerHomeClient
          services={[draftRow, publishedRow]}
          domainPacks={samplePacks}
          servicesSource="api"
        />,
      );
      // Should show real counts (not an error state).
      const draftsLabel = screen.getByText("Drafts");
      expect(draftsLabel.parentElement?.textContent).toContain("1");
      expect(screen.getByText("Trade License")).toBeInTheDocument();
      expect(screen.queryByText(/couldn.t load/i)).toBeNull();
    });

    it("shows 'No services yet' only when source is api and list is empty", () => {
      render(
        <DesignerHomeClient
          services={[]}
          domainPacks={samplePacks}
          servicesSource="api"
        />,
      );
      expect(screen.getByText("No services yet")).toBeInTheDocument();
    });
  });

  // ── GAP-DESIGNER-HOME-03: pattern label formatting ───────────────────
  describe("GAP-DESIGNER-HOME-03: pattern label", () => {
    it("maps 'certificate' pattern to title-case 'Certificate / Permission'", () => {
      render(
        <DesignerHomeClient
          services={[draftRow]}
          domainPacks={samplePacks}
          servicesSource="api"
        />,
      );
      expect(screen.getByText("Certificate / Permission")).toBeInTheDocument();
      expect(screen.queryByText("certificate")).toBeNull();
    });

    it("maps 'booking' pattern to 'Booking / Reservation'", () => {
      render(
        <DesignerHomeClient
          services={[bookingRow]}
          domainPacks={samplePacks}
          servicesSource="api"
        />,
      );
      expect(screen.getByText("Booking / Reservation")).toBeInTheDocument();
    });

    it("maps 'grievance' pattern to 'Grievance / Case'", () => {
      render(
        <DesignerHomeClient
          services={[rejectedRow]}
          domainPacks={samplePacks}
          servicesSource="api"
        />,
      );
      expect(screen.getByText("Grievance / Case")).toBeInTheDocument();
    });
  });

  // ── GAP-DESIGNER-HOME-04: attention count expanded ───────────────────
  describe("GAP-DESIGNER-HOME-04: needs-attention stat", () => {
    it("counts rejected services in attention", () => {
      render(
        <DesignerHomeClient
          services={[draftRow, rejectedRow]}
          domainPacks={samplePacks}
          servicesSource="api"
        />,
      );
      // The "Needs Attention" card parent (.stat) should contain "1" for rejected.
      const label = screen.getByText("Needs Attention");
      // The stat card structure: div.stat > div.lab + div.val
      const statCard = label.parentElement;
      expect(statCard?.textContent).toContain("1");
    });

    it("counts draft with latestTestStatus=fail in attention", () => {
      const failDraft = { ...draftRow, latestTestStatus: "fail" } as DesignerServiceRow;
      render(
        <DesignerHomeClient
          services={[failDraft, publishedRow]}
          domainPacks={samplePacks}
          servicesSource="api"
        />,
      );
      // The "Needs Attention" card should count 1 (the failed test draft).
      const label = screen.getByText("Needs Attention");
      const statCard = label.parentElement;
      expect(statCard?.textContent).toContain("1");
    });
  });
});
