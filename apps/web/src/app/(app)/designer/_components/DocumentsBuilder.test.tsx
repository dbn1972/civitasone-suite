import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentsBuilder } from "./DocumentsBuilder";
import type { WorkflowLane } from "../_data/workflowConstants";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>{children as never}</a>
  ),
}));

function lane(partial: Partial<WorkflowLane> & { key: string; name: string }): WorkflowLane {
  return {
    id: partial.id ?? partial.key,
    optional: false,
    enabled: true,
    designationId: "",
    designationLabel: "",
    slaDays: 5,
    ...partial,
  };
}

const baseLanes: WorkflowLane[] = [
  lane({ key: "submitted", name: "Submitted" }),
  lane({ key: "inspection", name: "Inspection", designationLabel: "Licensing Inspector" }),
  lane({ key: "decision", name: "Decision" }),
  lane({ key: "issued", name: "Issued" }),
];

describe("DocumentsBuilder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows mandatory-without-lane warning banner and suggests a verifying lane", () => {
    render(
      <DocumentsBuilder
        serviceId="svc-1"
        lanes={baseLanes}
        initial={{
          documents: [{
            id: "d1",
            docType: "rent",
            labels: { en: "Rent agreement", hi: "" },
            formats: ["pdf"],
            maxSizeMb: 5,
            mandatory: true,
            verifiedAtLane: "",
          }],
        }}
      />,
    );

    expect(screen.getByTestId("mandatory-lane-warning-banner")).toHaveTextContent(/still continue/i);
    expect(screen.getByTestId("documents-locale-hint")).toHaveTextContent(/EN 1\/1 · HI 0\/1/i);

    fireEvent.click(screen.getByTestId("suggest-verified-at"));
    expect(screen.getByLabelText(/Verified at approval lane/i)).toHaveValue("inspection");
    expect(screen.queryByTestId("mandatory-lane-warning-banner")).not.toBeInTheDocument();
  });

  it("renders Verified at options with lane names and citizen upload preview depth", () => {
    render(
      <DocumentsBuilder
        serviceId="svc-1"
        lanes={baseLanes}
        initial={{
          documents: [{
            id: "d1",
            docType: "photo_id",
            labels: { en: "Photo ID", hi: "फोटो पहचान" },
            formats: ["jpg", "png"],
            maxSizeMb: 2,
            mandatory: true,
            verifiedAtLane: "inspection",
          }],
        }}
      />,
    );

    const select = screen.getByLabelText(/Verified at approval lane/i);
    expect(select).toHaveValue("inspection");
    expect(screen.getByRole("option", { name: /Inspection — Licensing Inspector/i })).toBeInTheDocument();

    const preview = screen.getByTestId("citizen-upload-preview");
    expect(preview).toHaveTextContent("Photo ID");
    expect(preview).toHaveTextContent("Required");
    expect(preview).toHaveTextContent("Take photo");
    expect(preview).toHaveTextContent("Max 2 MB");

    fireEvent.click(screen.getByRole("button", { name: "हिंदी" }));
    expect(preview).toHaveTextContent("फोटो पहचान");
  });

  it("surfaces empty verification lanes with Workflow deep-link", () => {
    render(
      <DocumentsBuilder
        serviceId="svc-9"
        lanes={[
          lane({ key: "submitted", name: "Submitted" }),
          lane({ key: "issued", name: "Issued" }),
        ]}
        initial={{
          documents: [{
            id: "d1",
            docType: "id",
            labels: { en: "ID", hi: "पहचान" },
            formats: ["pdf"],
            maxSizeMb: 5,
            mandatory: true,
            verifiedAtLane: "",
          }],
        }}
      />,
    );

    expect(screen.getByTestId("no-verification-lanes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Configure lanes in Workflow/i })).toHaveAttribute(
      "href",
      "/designer/svc-9/b4",
    );
  });
});
