import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationMatrix } from "./NotificationMatrix";
import { seedMatrixForPattern } from "./notificationTypes";
import type { FormDesignState } from "./formTypes";

const sampleForm: FormDesignState = {
  sections: [{ id: "sample", label: "Sample answers", fieldIds: ["applicant_name"] }],
  fields: {
    applicant_name: {
      id: "applicant_name",
      apiName: "applicant_name",
      type: "text",
      label: "Applicant name",
      required: false,
      sectionId: "sample",
    },
  },
};

describe("NotificationMatrix", () => {
  it("opens the editor when an enabled cell is clicked instead of turning it off", () => {
    const matrix = seedMatrixForPattern("certificate");
    const onChange = vi.fn();
    render(<NotificationMatrix matrix={matrix} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(/Edit Application submitted SMS template/i));

    expect(screen.getByRole("heading", { name: /Edit template/i })).toBeInTheDocument();
    expect(screen.getByTestId("channel-enabled-badge")).toHaveTextContent("Enabled");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("enables an Off cell and opens the editor", () => {
    const matrix = seedMatrixForPattern("certificate");
    const onChange = vi.fn();
    render(<NotificationMatrix matrix={matrix} onChange={onChange} />);

    const offButtons = screen.getAllByRole("button", { name: /Enable /i });
    expect(offButtons.length).toBeGreaterThan(0);
    fireEvent.click(offButtons[0]);
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /Edit template/i })).toBeInTheDocument();
  });

  it("turns off via explicit control and shows channel + FormRenderer previews", () => {
    const matrix = seedMatrixForPattern("certificate");
    const onChange = vi.fn();
    render(
      <NotificationMatrix
        matrix={matrix}
        onChange={onChange}
        sampleFormDesign={sampleForm}
        sampleValues={{ applicant_name: "Asha Devi", service_name: "Trade License", app_no: "TL/1" }}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Edit Application submitted SMS template/i));
    expect(screen.getByTestId("channel-preview-sms")).toBeInTheDocument();
    expect(screen.getByTestId("notification-sample-form")).toBeInTheDocument();
    expect(screen.getByLabelText(/Applicant name/i)).toBeInTheDocument();
    expect(screen.getByTestId("sms-stats")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("template-turn-off"));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.submitted.sms.enabled).toBe(false);
  });

  it("dims optional pattern events for collection", () => {
    const matrix = seedMatrixForPattern("collection");
    render(<NotificationMatrix matrix={matrix} onChange={vi.fn()} pattern="collection" />);
    expect(screen.getAllByText(/optional for this pattern/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("cell-approved-sms")).toHaveAttribute("aria-pressed", "false");
  });
});
