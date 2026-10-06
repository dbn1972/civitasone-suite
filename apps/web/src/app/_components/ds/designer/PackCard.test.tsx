import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PackCard } from "./PackCard";
import type { ServicePackDto } from "@/app/(app)/designer/_data/packLibraryApi";

const pack: ServicePackDto = {
  id: "p1",
  packKey: "pack:property-tax",
  domainPackKey: "property_tax",
  name: "Property Tax",
  servicePattern: "collection",
  feeModel: "slab",
  hoaCode: null,
  statutoryReferences: [],
  manifest: {},
  version: 2,
  status: "published",
};

describe("PackCard — GAP-DESIGNER-LIBRARY-03", () => {
  it("shows the domain display name instead of the raw domainPackKey", () => {
    render(
      <PackCard
        pack={pack}
        domainName="Property Tax Domain"
        onPreview={vi.fn()}
        onImport={vi.fn()}
      />,
    );
    expect(screen.getByText(/Property Tax Domain/)).toBeInTheDocument();
    // raw token must not appear
    expect(screen.queryByText(/property_tax/)).not.toBeInTheDocument();
  });

  it("humanizes an enum-code sector into Title Case", () => {
    render(
      <PackCard
        pack={pack}
        sector="urban_local_body"
        onPreview={vi.fn()}
        onImport={vi.fn()}
      />,
    );
    expect(screen.getByText(/Urban Local Body/)).toBeInTheDocument();
    expect(screen.queryByText(/urban_local_body/)).not.toBeInTheDocument();
  });

  it("falls back to a humanized domainPackKey when no domainName is given", () => {
    render(<PackCard pack={pack} onPreview={vi.fn()} onImport={vi.fn()} />);
    // property_tax -> Property Tax, shown in the meta line (joined with " · ").
    expect(screen.getByText(/Property Tax · v2/)).toBeInTheDocument();
    expect(screen.queryByText(/property_tax/)).not.toBeInTheDocument();
  });
});
