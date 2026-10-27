import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
    // FN-25 — required on WorkflowLane; default alongside the other required strings.
    escalationDesignationId: "",
    escalationDesignationLabel: "",
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

  // GAP-DESIGNER-DETAIL-B6-02
  it("renders one tab and one preview toggle per configured locale", () => {
    render(
      <DocumentsBuilder
        serviceId="svc-or"
        lanes={baseLanes}
        locales={["en", "or"]}
        initial={{
          documents: [{
            id: "d-or",
            docType: "rent",
            labels: { en: "Rent agreement", hi: "", or: "" },
            formats: ["pdf"],
            maxSizeMb: 5,
            mandatory: false,
            verifiedAtLane: "",
          }],
        }}
      />,
    );
    expect(screen.getByRole("tab", { name: /ଓଡ଼ିଆ/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /हिंदी/ })).toBeNull();
    const group = screen.getByRole("group", { name: "Preview language" });
    expect(group.textContent).toContain("ଓଡ଼ିଆ");
    expect(group.textContent).not.toContain("हिंदी");
    expect(screen.getByTestId("documents-locale-hint").textContent).toContain("EN 1/1 · OR 0/1");
  });
  // WCAG 3.1.2 (Language of Parts): the secondary label carries the language of the locale that supplied it.
  it("tags the secondary preview label with the locale that supplied it", () => {
    render(
      <DocumentsBuilder
        serviceId="svc-lang"
        lanes={baseLanes}
        locales={["en", "or"]}
        initial={{
          documents: [{
            id: "d-lang",
            docType: "rent",
            labels: { en: "Rent agreement", hi: "", or: "ଭଡ଼ା ଚୁକ୍ତି" },
            formats: ["pdf"],
            maxSizeMb: 5,
            mandatory: false,
            verifiedAtLane: "",
          }],
        }}
      />,
    );
    fireEvent.click(within(screen.getByRole("group", { name: "Preview language" })).getByRole("button", { name: /ଓଡ଼ିଆ/ }));
    expect(screen.getByText("ଭଡ଼ା ଚୁକ୍ତି").closest("[lang]")).toHaveAttribute("lang", "or");
    expect(screen.getByText("Rent agreement", { selector: "div[lang]" })).toHaveAttribute("lang", "en");
  });
});

// Owner decision D4c #8 (GAP-DESIGNER-DETAIL-B6-03)
describe("DocumentsBuilder — document category (DPO-classified catalogue)", () => {
  const doc = {
    id: "d1", docType: "", labels: { en: "", hi: "" }, formats: ["pdf" as const],
    maxSizeMb: 5, mandatory: true, verifiedAtLane: "",
  };

  it("choosing Aadhaar copy shows a sensitive badge, the retention hint and DPO-to-confirm, and sets the shared docType", () => {
    const onChange = vi.fn();
    render(<DocumentsBuilder serviceId="s" lanes={baseLanes} initial={{ documents: [doc] }} onDesignChange={onChange} />);
    fireEvent.click(screen.getByText("Untitled"));
    fireEvent.change(screen.getByLabelText("Document category"), { target: { value: "aadhaar_copy" } });
    const info = screen.getByTestId("doc-category-info");
    expect(info.textContent).toContain("Sensitive");
    expect(info.textContent).toMatch(/delete the copy once it is verified/i);
    expect(info.textContent).toContain("DPO to confirm");
    const last = onChange.mock.calls.at(-1)![0] as { documents: Array<{ docType: string; categoryId: string; labels: { en: string } }> };
    expect(last.documents[0]).toMatchObject({ docType: "aadhaar_copy", categoryId: "aadhaar_copy" });
    expect(last.documents[0]!.labels.en).toBe("Aadhaar copy");
  });

  it("Other keeps free text and shows no classification", () => {
    render(<DocumentsBuilder serviceId="s" lanes={baseLanes} initial={{ documents: [{ ...doc, docType: "rent", labels: { en: "Rent", hi: "" } }] }} />);
    fireEvent.click(screen.getByText("Rent"));
    expect((screen.getByLabelText("Document category") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByTestId("doc-category-info")).toBeNull();
  });
});

