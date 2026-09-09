import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataSourceBadge } from "./DataSourceBadge";

describe("DataSourceBadge", () => {
  describe("legacy `source` prop (no pairing cache, e.g. a page with no seeded table)", () => {
    it("renders nothing when source is 'api' (healthy)", () => {
      const { container } = render(<DataSourceBadge source="api" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("renders the honest default badge when source is 'error'", () => {
      render(<DataSourceBadge source="error" />);
      expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    });

    // Fails-before / passes-after guard. The fetch layer (apiClient.fetchJson)
    // returns the EMPTY fallback on every failure branch and has no stale-cache
    // path, so source="error" never means cached data is on screen. The old
    // default copy "Showing saved information" lied about that; this test locks
    // in that the default can never again claim saved/cached data.
    it("default error copy never implies saved/cached data (truthful)", () => {
      render(<DataSourceBadge source="error" />);
      const badge = screen.getByRole("status");
      expect(badge.textContent ?? "").not.toMatch(/saved|cached|stored information/i);
    });

    it("has role=status for screen readers", () => {
      render(<DataSourceBadge source="error" />);
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("renders a custom message when provided", () => {
      render(<DataSourceBadge source="error" message="Couldn't load — showing nothing" />);
      expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    });

    it("lets a surface pass a more specific truthful message", () => {
      render(<DataSourceBadge source="error" message="Couldn't load claims" />);
      expect(screen.getByText("Couldn't load claims")).toBeInTheDocument();
    });
  });

  describe("`provenance` prop — UX-002 single source of truth", () => {
    it("renders nothing for provenance='live'", () => {
      render(<DataSourceBadge provenance="live" />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("renders exactly one honest, combined message for provenance='cached' — never a contradictory pair", () => {
      render(<DataSourceBadge provenance="cached" cachedAt="2026-09-01T10:00:00.000Z" />);
      const nodes = screen.getAllByRole("status");
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toHaveTextContent(/Showing saved data/i);
      expect(nodes[0]).toHaveTextContent(/from/i);
      expect(nodes[0]).toHaveTextContent(/could not refresh/i);
      // The whole point of UX-002: this state must never also claim "showing nothing".
      expect(nodes[0]).not.toHaveTextContent(/showing nothing/i);
    });

    it("appends an offline note for provenance='cached' when offline", () => {
      render(<DataSourceBadge provenance="cached" cachedAt={null} offline />);
      expect(screen.getByRole("status")).toHaveTextContent(/you're offline/i);
    });

    it("renders the plain empty-state message for provenance='error-no-data'", () => {
      render(<DataSourceBadge provenance="error-no-data" />);
      const nodes = screen.getAllByRole("status");
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toHaveTextContent("Couldn't load — showing nothing");
      // And never simultaneously claim saved data is on screen.
      expect(nodes[0]).not.toHaveTextContent(/Showing saved data/i);
    });

    it("honors a message override for provenance='error-no-data'", () => {
      render(<DataSourceBadge provenance="error-no-data" message="Couldn't load payroll runs — showing nothing" />);
      expect(screen.getByRole("status")).toHaveTextContent("Couldn't load payroll runs — showing nothing");
    });
  });
});
