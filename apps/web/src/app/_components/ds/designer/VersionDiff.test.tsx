import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VersionDiff } from "./VersionDiff";
import type { ServiceDefinitionDto } from "@/app/(app)/designer/_data/designerApi";

const current: ServiceDefinitionDto = {
  id: "def-1",
  serviceKey: "tl",
  name: "Trade License",
  servicePattern: "certificate",
  channels: ["portal"],
  status: "draft",
  version: 2,
  hoaCode: "4201",
  feeModel: "flat",
  slaDays: 21,
  requiredDocuments: [{ docType: "id", mandatory: true }],
  forms: [
    {
      formDesign: { sections: [], fields: { a: {}, b: {} } },
      runtimeMeta: { feeFromMinor: 75000 },
    },
  ],
};

describe("VersionDiff", () => {
  it("shows first-version banner when nothing is published", () => {
    render(<VersionDiff current={current} published={null} />);
    expect(screen.getAllByText(/first version/i).length).toBeGreaterThan(0);
  });

  it("shows human-readable fee amount change in unified mode", () => {
    render(
      <VersionDiff
        current={current}
        published={{
          name: "Trade License",
          hoaCode: "4100",
          feeModel: "flat",
          channels: ["portal"],
          requiredDocuments: [],
          forms: [{ runtimeMeta: { feeFromMinor: 50000 }, formDesign: { fields: { a: {} } } }],
        }}
      />,
    );
    expect(screen.getByText(/Fee changed ₹500 → ₹750/i)).toBeInTheDocument();
    expect(screen.getByText(/Head of Account changed/i)).toBeInTheDocument();
  });

  it("toggles to side-by-side columns", () => {
    render(
      <VersionDiff
        current={current}
        published={{ name: "Old name", channels: ["portal"], requiredDocuments: [] }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Side by side/i }));
    expect(screen.getByText("Old name")).toBeInTheDocument();
    expect(screen.getByText("Trade License")).toBeInTheDocument();
  });
});

describe("PackCard", () => {
  it("renders preview and import actions with sector meta", async () => {
    const { PackCard } = await import("./PackCard");
    const onPreview = vi.fn();
    const onImport = vi.fn();
    render(
      <PackCard
        pack={{
          id: "p1",
          packKey: "pack:trade-license",
          domainPackKey: "municipal-in-v1",
          name: "Trade License",
          servicePattern: "certificate",
          feeModel: "flat",
          hoaCode: "4201",
          statutoryReferences: [{ act: "Municipal Act" }],
          manifest: {},
          version: 1,
          status: "published",
        }}
        source="Domain · Municipal India v1"
        sector="municipal"
        jurisdiction="IN"
        onPreview={onPreview}
        onImport={onImport}
      />,
    );
    expect(screen.getByText(/municipal/i)).toBeInTheDocument();
    expect(screen.getByText(/Statutory/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    expect(onPreview).toHaveBeenCalled();
  });
});
