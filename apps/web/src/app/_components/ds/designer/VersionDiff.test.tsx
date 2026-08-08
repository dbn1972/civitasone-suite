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
};

describe("VersionDiff", () => {
  it("shows first-version banner when nothing is published", () => {
    render(<VersionDiff current={current} published={null} />);
    expect(screen.getAllByText(/first version/i).length).toBeGreaterThan(0);
  });

  it("shows human-readable fee/HOA changes", () => {
    render(
      <VersionDiff
        current={current}
        published={{ name: "Trade License", hoaCode: "4100", feeModel: "slab", channels: ["portal"], requiredDocuments: [] }}
      />,
    );
    expect(screen.getByText(/Head of Account/i)).toBeInTheDocument();
    expect(screen.getByText(/HOA 4100/)).toBeInTheDocument();
    expect(screen.getByText(/HOA 4201/)).toBeInTheDocument();
  });
});

describe("PackCard", () => {
  it("renders preview and import actions", async () => {
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
        onPreview={onPreview}
        onImport={onImport}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview/i }));
    expect(onPreview).toHaveBeenCalled();
  });
});
