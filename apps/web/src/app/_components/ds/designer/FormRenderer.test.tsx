import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormRenderer } from "./FormRenderer";
import type { FormDesignState } from "./formTypes";

const design: FormDesignState = {
  sections: [{ id: "s1", label: "Details", fieldIds: ["f1"] }],
  fields: {
    f1: { id: "f1", apiName: "name", type: "text", label: "Applicant name", required: true, sectionId: "s1" },
  },
};

describe("FormRenderer", () => {
  it("renders preview fields", () => {
    render(<FormRenderer design={design} />);
    expect(screen.getByLabelText(/Applicant name/)).toBeInTheDocument();
    expect(screen.getByText(/Runtime skeleton/)).toBeInTheDocument();
  });

  it("renders stepped mode without runtime note", () => {
    render(<FormRenderer design={design} mode="stepped" showRuntimeNote={false} />);
    expect(screen.getByLabelText(/Applicant name/)).toBeInTheDocument();
    expect(screen.queryByText(/Runtime skeleton/)).not.toBeInTheDocument();
  });
});
