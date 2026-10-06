import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MetadataHubPage from "./page";

describe("MetadataHubPage", () => {
  // GAP-METADATA-HOME-02: the subtitle used to expose "/api/v1/metadata/*"
  // and a card description exposed "/api/v1/metadata/entities".
  it("contains no /api/ path in visible copy", () => {
    const { container } = render(<MetadataHubPage />);
    expect(container.textContent ?? "").not.toContain("/api/");
  });

  // GAP-METADATA-HOME-03: each card title equals the page it leads to.
  it("has five tiles with distinct titles", () => {
    render(<MetadataHubPage />);
    expect(screen.getByText("Entities")).toBeInTheDocument();
    expect(screen.getByText("Fields")).toBeInTheDocument();
    expect(screen.getByText("Validation rules")).toBeInTheDocument();
    expect(screen.getByText("Records")).toBeInTheDocument();
    expect(screen.getByText("Forms")).toBeInTheDocument();
  });

  // GAP-METADATA-HOME-04: each card is wrapped in a <Link> (whole tile
  // clickable), not just a tiny text-only underlined link.
  it("wraps each tile in a clickable link", () => {
    const { container } = render(<MetadataHubPage />);
    const links = container.querySelectorAll('a.mtile');
    expect(links).toHaveLength(5);
    expect((links[0] as HTMLAnchorElement).href).toContain("/metadata/entities");
  });
});
