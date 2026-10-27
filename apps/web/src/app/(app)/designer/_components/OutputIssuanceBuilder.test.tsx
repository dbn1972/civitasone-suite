import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emptyIssuanceDesign } from "@/app/_components/ds/designer/issuanceTypes";
import { OutputIssuanceBuilder } from "./OutputIssuanceBuilder";

vi.mock("../_data/issuanceBuilderApi", async () => {
  const actual = await vi.importActual<typeof import("../_data/issuanceBuilderApi")>(
    "../_data/issuanceBuilderApi",
  );
  return {
    ...actual,
    fetchTenantPositions: vi.fn().mockResolvedValue([
      { id: "pos-1", label: "Licensing Officer" },
    ]),
    requestSamplePdf: vi.fn().mockResolvedValue({
      ok: true,
      mode: "sandbox",
      mergedText: "Sandbox body for Sample Applicant",
      banner: "Designer sandbox preview — sample data only.",
      numberingExample: "TL/W12/2026/00041",
      message: "Designer sandbox preview — sample data only.",
    }),
  };
});

describe("OutputIssuanceBuilder", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows grievance closure-note default hint and sample sandbox preview", async () => {
    render(
      <OutputIssuanceBuilder
        serviceName="Ward grievance"
        pattern="grievance"
        initial={emptyIssuanceDesign("grievance")}
      />,
    );

    expect(screen.getByTestId("grievance-closure-hint")).toHaveTextContent(/Closure note/i);
    expect(screen.getByTestId("output-type")).toHaveValue("closure_note");

    fireEvent.click(screen.getByTestId("generate-sample-pdf"));
    await waitFor(() => {
      expect(screen.getByTestId("sample-preview-banner")).toHaveTextContent(/sandbox/i);
    });
    expect(screen.getByTestId("template-preview")).toHaveTextContent(/Sample Applicant/i);
  });

  it("applies licence defaults when switching output type from stock certificate", () => {
    render(
      <OutputIssuanceBuilder
        serviceName="Trade Licence"
        pattern="certificate"
        initial={emptyIssuanceDesign("certificate")}
      />,
    );

    fireEvent.change(screen.getByTestId("output-type"), { target: { value: "licence" } });
    expect(screen.getByTestId("output-type")).toHaveValue("licence");
    expect((screen.getByTestId("template-body") as HTMLTextAreaElement).value).toMatch(/Licence/);
  });

  it("surfaces numbering warning and renewal window when renewable", () => {
    const initial = emptyIssuanceDesign("certificate");
    initial.numberingTokens = [{ kind: "prefix", value: "TL" }];
    initial.renewable = true;

    render(
      <OutputIssuanceBuilder
        serviceName="Trade Licence"
        initial={initial}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Numbering" }));
    expect(screen.getByTestId("numbering-warning")).toHaveTextContent(/Sequence/i);

    fireEvent.click(screen.getByRole("tab", { name: "Validity" }));
    expect(screen.getByTestId("renewal-window-days")).toBeInTheDocument();
    expect(screen.getByTestId("renewal-guidance")).toHaveTextContent(/FN-15/i);
  });

  it("updates signatory label on the template preview", async () => {
    render(
      <OutputIssuanceBuilder
        serviceName="Trade Licence"
        initial={emptyIssuanceDesign("certificate")}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Signatory" }));
    await waitFor(() => {
      expect(screen.getByTestId("signatory-select")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId("signatory-select"), { target: { value: "pos-1" } });
    fireEvent.click(screen.getByRole("tab", { name: "Certificate" }));
    expect(screen.getByTestId("preview-signatory")).toHaveTextContent("Licensing Officer");
  });

  // GAP-DESIGNER-DETAIL-B7-01
  it("shows offline when the persist callback rejects", async () => {
    vi.useFakeTimers();
    const onSaveState = vi.fn();
    const onDesignPersisted = vi.fn().mockRejectedValue(new Error("PATCH failed"));
    render(
      <OutputIssuanceBuilder
        serviceName="Trade Licence"
        pattern="certificate"
        initial={emptyIssuanceDesign("certificate")}
        onSaveState={onSaveState}
        onDesignPersisted={onDesignPersisted}
      />,
    );
    fireEvent.change(screen.getByTestId("output-type"), { target: { value: "licence" } });
    await vi.advanceTimersByTimeAsync(2100);
    expect(onDesignPersisted).toHaveBeenCalled();
    expect(onSaveState).toHaveBeenLastCalledWith("offline");
    expect(onSaveState).not.toHaveBeenCalledWith("saved");
  });

  it("does not write anything just because the page was opened", async () => {
    vi.useFakeTimers();
    const onDesignPersisted = vi.fn().mockResolvedValue(undefined);
    const initial = emptyIssuanceDesign("certificate");
    const { rerender } = render(
      <OutputIssuanceBuilder serviceName="x" pattern="certificate" initial={initial} onDesignPersisted={onDesignPersisted} />,
    );
    rerender(
      <OutputIssuanceBuilder serviceName="x" pattern="certificate" initial={initial} onDesignPersisted={async (d) => onDesignPersisted(d)} />,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(onDesignPersisted).not.toHaveBeenCalled();
  });
});
